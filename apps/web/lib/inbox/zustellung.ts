/**
 * Zustellung: wird von `protokolliere` in DERSELBEN Transaktion aufgerufen.
 * Rollback des Schreibpfads = kein Ereignis = keine Zustellung. Dies ist die
 * einzige Stelle, die inbox_eintrag beim Zustellen schreibt (Upsert) — und
 * die einzige, die Zugriffsanfragen und Pruefauftraege abraeumt.
 *
 * AP2.4 PR a (E62): Ein Ereignis kann mehrere Typen ausloesen (Register-
 * Reihenfolge: Aufgabe/Rueckmeldung vor Hinweis). Wer fuer dasselbe Ereignis
 * schon bedient wurde, bekommt keinen zweiten Eintrag (D6).
 */
import { benutzer, biomassestrom, inboxEintrag, kommentar, outputBedarf, stromZuweisung } from "@bhyo/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { beteiligteAus, type ProtokollZeile } from "@/lib/protokoll/ableitung";
import { protokollZeilen } from "@/lib/protokoll/server";
import type { Entitaet, EreignisArt } from "@/lib/protokoll";

import { filtereEmpfaenger } from "./empfaenger";
import { typenFuerArt, type InboxTyp } from "./register";

export type Schreiber = Pick<AppDb, "insert" | "select" | "update">;

export interface ZustellEreignis {
  id: string;
  art: EreignisArt;
  entitaet: Entitaet;
  entitaetId: string;
  ausloeserId: string;
  /** Betroffene Person (zugewiesen: der Zugewiesene; zugriff_abgelehnt: der Anfragende). */
  betrifftId?: string | null;
  /** Rohtext des Ereignisses (Notiz der Zugriffsanfrage). */
  text?: string | null;
  /** PR c: Aufgabentext bei weitergegeben (inbox_eintrag.aufgabe). */
  aufgabe?: string | null;
  /** AP2.6 PR c (E71): neu erwaehnte Nutzer eines Kommentars (Typ erwaehnung). */
  erwaehnteIds?: readonly string[] | null;
}

type StromSpalte = "biomassestromId" | "outputBedarfId";

function stromSpalte(entitaet: Entitaet): StromSpalte | null {
  if (entitaet === "biomassestrom") return "biomassestromId";
  if (entitaet === "output_bedarf") return "outputBedarfId";
  return null;
}

/** Ereignisarten, die einen Pruefauftrag ausloesen bzw. beenden (E62). */
const AUFTRAG_ARTEN: readonly EreignisArt[] = ["in_pruefung_gegeben", "zurueckgesetzt"];
export const AUFTRAG_ABRAEUMEN_BEI: readonly EreignisArt[] = ["geprueft", "zurueckgegeben", "verworfen"];
/** PR b (E63): Typen der Job-Hinweise (lib/inbox/hinweise.ts). */
export const HINWEIS_TYPEN = ["verifikation_laeuft_ab", "verifikation_abgelaufen"] as const satisfies readonly InboxTyp[];
/**
 * PR b: Ereignisse, nach denen ein Ablauf-Hinweis zu diesem Strom gegenstandslos
 * ist — neuer Prueftag (geprueft, reverifiziert), Strom nicht mehr geprueft
 * (in Pruefung gegeben, zurueckgesetzt, verworfen) oder Beleg markiert (D3:
 * keine Erinnerungen mehr). Die Hinweise werden bei ALLEN Empfaengern erledigt.
 */
/**
 * PR c (D5): Eine Aufgabe ist erledigt, sobald der Strom geprueft (oder erneut
 * verifiziert) ist — oder verworfen; sonst erledigt sie der Empfaenger selbst.
 */
export const AUFGABE_ABRAEUMEN_BEI: readonly EreignisArt[] = ["geprueft", "reverifiziert", "verworfen"];
export const HINWEIS_ABRAEUMEN_BEI: readonly EreignisArt[] = [
  "geprueft",
  "reverifiziert",
  "in_pruefung_gegeben",
  "zurueckgesetzt",
  "verworfen",
  "als_abgelaufen_markiert",
];

/**
 * Wer den Pruefauftrag ausgeloest hat: Urheber des letzten Ereignisses
 * in_pruefung_gegeben / zurueckgesetzt — rein aus dem Protokoll (E23).
 */
export function auftraggeberAus(zeilen: readonly ProtokollZeile[]): string | null {
  const letzte = [...zeilen]
    .filter((z) => AUFTRAG_ARTEN.includes(z.art) && z.benutzerId)
    .sort((a, b) => b.zeitpunkt.getTime() - a.zeitpunkt.getTime())[0];
  return letzte?.benutzerId ?? null;
}

/** Empfaenger eines Ereignisses fuer EINEN Typ laut Register — leer, wenn niemand. */
export async function empfaengerFuer(tx: Schreiber, e: ZustellEreignis, typ: InboxTyp): Promise<string[]> {
  const spalte = stromSpalte(e.entitaet);
  if (!spalte) return [];
  switch (typ) {
    case "aenderung_eintrag": {
      // Beteiligte aus dem Protokoll (inklusive des gerade geschriebenen Ereignisses) —
      // plus die im Ereignis benannte betroffene Person (AP2.5 PR c: beim
      // Zusammenfuehren der Sperrinhaber jedes betroffenen Stroms).
      const beteiligte = beteiligteAus(await protokollZeilen(tx, e.entitaet, e.entitaetId));
      if (e.betrifftId && !beteiligte.includes(e.betrifftId)) beteiligte.push(e.betrifftId);
      if (beteiligte.length === 0) return [];
      const kandidaten = await tx
        .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
        .from(benutzer)
        .where(inArray(benutzer.id, beteiligte));
      return filtereEmpfaenger(beteiligte, kandidaten, e.ausloeserId);
    }
    case "zugriffsanfrage": {
      // Der Sperrinhaber — ist er kein Pruefer mehr oder deaktiviert, alle aktiven Admins.
      const t = spalte === "biomassestromId" ? biomassestrom : outputBedarf;
      const [strom] = await tx
        .select({ gesperrtVon: t.gesperrtVon, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
        .from(t)
        .leftJoin(benutzer, eq(benutzer.id, t.gesperrtVon))
        .where(eq(t.id, e.entitaetId));
      if (strom?.gesperrtVon && strom.rolle === "pruefer" && strom.aktiv) return [strom.gesperrtVon];
      const admins = await tx
        .select({ id: benutzer.id })
        .from(benutzer)
        .where(and(eq(benutzer.rolle, "admin"), eq(benutzer.aktiv, true)));
      return admins.map((a) => a.id).filter((id) => id !== e.ausloeserId);
    }
    case "freischaltung":
    case "zugriff_abgelehnt":
    case "aufgabe":
      // Die betroffene Person — nie der Ausloeser selbst (Weitergeben an sich selbst weist die Action ab).
      return e.betrifftId && e.betrifftId !== e.ausloeserId ? [e.betrifftId] : [];
    case "pruefauftrag": {
      // E62: alle aktiven Pruefer und Admins (admin ⊇ pruefer), ausser dem Ausloeser.
      const pruefer = await tx
        .select({ id: benutzer.id })
        .from(benutzer)
        .where(and(inArray(benutzer.rolle, ["pruefer", "admin"]), eq(benutzer.aktiv, true)));
      return pruefer.map((p) => p.id).filter((id) => id !== e.ausloeserId);
    }
    case "verifikation_laeuft_ab":
    case "verifikation_abgelaufen":
    case "akteur_verwaist":
    case "kontaktperson_loeschpruefung":
    case "biomasse_wird_frei":
    case "import_abgeschlossen":
    case "mail_stoerung":
    case "mail_secret_laeuft_ab":
      // PR b / AP2.5: nicht ereignisgetrieben — der Job stellt zu (lib/inbox/hinweise.ts).
      // AP2.7 (E67): import_abgeschlossen stellt der Import selbst zu (PR c), je Lauf gebuendelt.
      // AP2.9 Umschalten: die Mail-Hinweise stellt der Roundup-Job zu (lib/inbox/mail-hinweise.ts).
      return [];
    case "kommentar":
    case "erwaehnung":
      // AP2.6 PR c (E71): Objektbezug Kommentar — eigener Weg (zustelleKommentar), nicht ueber die Strom-Spalte.
      return [];
    case "pruefung_erledigt": {
      // E62: die Person, die den Auftrag ausgeloest hat — nie der Pruefer selbst, nie Deaktivierte.
      const auftraggeber = auftraggeberAus(await protokollZeilen(tx, e.entitaet, e.entitaetId));
      if (!auftraggeber || auftraggeber === e.ausloeserId) return [];
      const [b] = await tx
        .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
        .from(benutzer)
        .where(eq(benutzer.id, auftraggeber));
      return b && b.aktiv ? [b.id] : [];
    }
  }
}

/**
 * Offene Eintraege eines Typs zu einem Strom erledigen — bei ALLEN Empfaengern
 * (wer handelt, raeumt bei allen ab). Mit `ausloeserId` nur die Eintraege
 * dieser Person (Zuweisen, Ablehnen), ohne alle (Entsperren, Pruefen).
 */
export async function raeumeAb(
  tx: Schreiber,
  spalte: StromSpalte,
  stromId: string,
  typ: "zugriffsanfrage" | "pruefauftrag" | "aufgabe" | (typeof HINWEIS_TYPEN)[number],
  ausloeserId?: string,
): Promise<number> {
  const stromSpalteRef = spalte === "biomassestromId" ? inboxEintrag.biomassestromId : inboxEintrag.outputBedarfId;
  const jetzt = new Date();
  const geaendert = await tx
    .update(inboxEintrag)
    .set({ zustand: "erledigt", zustandSeit: jetzt })
    .where(
      and(
        eq(stromSpalteRef, stromId),
        eq(inboxEintrag.zustand, "offen"),
        sql`${inboxEintrag.typ}::text = ${typ}`,
        ausloeserId ? eq(inboxEintrag.ausloeserId, ausloeserId) : undefined,
      ),
    )
    .returning({ id: inboxEintrag.id });
  return geaendert.length;
}

/** Bisheriger Name fuer die Zugriffsanfragen (PR c) — dieselbe Funktion. */
export function raeumeAnfragenAb(tx: Schreiber, spalte: StromSpalte, stromId: string, ausloeserId?: string): Promise<number> {
  return raeumeAb(tx, spalte, stromId, "zugriffsanfrage", ausloeserId);
}

export async function zustellen(tx: Schreiber, e: ZustellEreignis): Promise<number> {
  // AP2.6 PR c (E71): Kommentar-Ereignisse haben den Objektbezug kommentar_id.
  if (e.entitaet === "kommentar") return zustelleKommentar(tx, e);
  const spalte = stromSpalte(e.entitaet);
  if (!spalte) return 0;

  // PR c: Abraeumen VOR dem Zustellen — Zuweisung und Ablehnung erledigen die
  // Anfragen dieser Person, Entsperren alle Anfragen zum Strom (ohne Mitteilung).
  if (e.art === "zugewiesen" && e.betrifftId) await raeumeAb(tx, spalte, e.entitaetId, "zugriffsanfrage", e.betrifftId);
  if (e.art === "zugriff_abgelehnt" && e.betrifftId) await raeumeAb(tx, spalte, e.entitaetId, "zugriffsanfrage", e.betrifftId);
  if (e.art === "entsperrt") await raeumeAb(tx, spalte, e.entitaetId, "zugriffsanfrage");
  // E62: Pruefen, Zurueckgeben und Verwerfen erledigen den Pruefauftrag bei allen Pruefern.
  if (AUFTRAG_ABRAEUMEN_BEI.includes(e.art)) await raeumeAb(tx, spalte, e.entitaetId, "pruefauftrag");
  // PR b: Ablauf-Hinweise des Jobs sind nach diesen Ereignissen gegenstandslos.
  if (HINWEIS_ABRAEUMEN_BEI.includes(e.art)) for (const typ of HINWEIS_TYPEN) await raeumeAb(tx, spalte, e.entitaetId, typ);
  // PR c: Aufgaben zu diesem Strom sind mit der Pruefung erfuellt (oder mit dem Verwerfen gegenstandslos).
  if (AUFGABE_ABRAEUMEN_BEI.includes(e.art)) await raeumeAb(tx, spalte, e.entitaetId, "aufgabe");

  const typen = typenFuerArt(e.art);
  if (!typen.length) return 0;
  const jetzt = new Date();
  const zielSpalte = spalte === "biomassestromId" ? inboxEintrag.biomassestromId : inboxEintrag.outputBedarfId;
  // D6: je Ereignis bekommt jede Person hoechstens EINEN Eintrag — der erste Typ der Registerreihenfolge.
  const bedient = new Set<string>();
  let gesamt = 0;
  for (const typ of typen) {
    const empfaenger = (await empfaengerFuer(tx, e, typ)).filter((id) => !bedient.has(id));
    for (const empfaengerId of empfaenger) {
      bedient.add(empfaengerId);
      gesamt += 1;
      const werte = {
        empfaengerId,
        ausloeserId: e.ausloeserId,
        typ,
        [spalte]: e.entitaetId,
        ereignisId: e.id,
        anzahl: 1,
        erstelltAm: jetzt,
        aktualisiertAm: jetzt,
        zustand: "offen" as const,
        zustandSeit: jetzt,
        notiz: typ === "zugriffsanfrage" ? (e.text ?? null) : null,
        // PR c: Aufgabentext nur beim Typ aufgabe (CHECK inbox_eintrag_aufgabe_check).
        aufgabe: typ === "aufgabe" ? (e.aufgabe ?? null) : null,
      };
      const einfuegen = tx.insert(inboxEintrag).values(werte);
      const konflikt = buendelung(typ, zielSpalte);
      if (!konflikt) {
        await einfuegen;
        continue;
      }
      // Buendelung per DB: Konflikt auf dem partiellen Unique-Index => anzahl + 1,
      // Ausloeser/Ereignis neu, wieder ungelesen (bei Anfragen auch die Notiz).
      await einfuegen.onConflictDoUpdate({
        target: konflikt.target,
        targetWhere: konflikt.where,
        set: {
          anzahl: sql`${inboxEintrag.anzahl} + 1`,
          ausloeserId: e.ausloeserId,
          ereignisId: e.id,
          aktualisiertAm: jetzt,
          gelesenAm: null,
          ...(typ === "zugriffsanfrage" ? { notiz: e.text ?? null } : {}),
        },
      });
    }
  }
  return gesamt;
}

/**
 * AP2.6 PR c (E71): Wer ist fuer das Objekt eines Kommentars verantwortlich?
 * Strom: Beteiligte laut Protokoll (E23, BETEILIGUNGS_ARTEN) plus Sperrinhaber
 * und Zugewiesene (E44); Akteur: die Urheber seiner Protokollereignisse. Ohne
 * Doppelte, ungefiltert — Rolle, Zustand und Autor filtert der Aufrufer.
 */
export async function verantwortlicheDesObjekts(
  tx: Schreiber,
  k: { biomassestromId: string | null; outputBedarfId: string | null; akteurId: string | null },
): Promise<string[]> {
  const ids: string[] = [];
  const merke = (id: string | null | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  if (k.biomassestromId || k.outputBedarfId) {
    const art: Entitaet = k.biomassestromId ? "biomassestrom" : "output_bedarf";
    const stromId = (k.biomassestromId ?? k.outputBedarfId)!;
    for (const id of beteiligteAus(await protokollZeilen(tx, art, stromId))) merke(id);
    const t = k.biomassestromId ? biomassestrom : outputBedarf;
    const [strom] = await tx.select({ gesperrtVon: t.gesperrtVon }).from(t).where(eq(t.id, stromId));
    merke(strom?.gesperrtVon);
    const zuweisungen = await tx
      .select({ nutzerId: stromZuweisung.nutzerId })
      .from(stromZuweisung)
      .where(eq(k.biomassestromId ? stromZuweisung.biomassestromId : stromZuweisung.outputBedarfId, stromId));
    for (const z of zuweisungen) merke(z.nutzerId);
  } else if (k.akteurId) {
    for (const z of await protokollZeilen(tx, "akteur", k.akteurId)) merke(z.benutzerId);
  }
  return ids;
}

/** Empfaenger eines Kommentar-Ereignisses je Typ (Register: erwaehnung vor kommentar). */
export async function kommentarEmpfaenger(
  tx: Schreiber,
  e: ZustellEreignis,
  k: { biomassestromId: string | null; outputBedarfId: string | null; akteurId: string | null },
  typ: InboxTyp,
): Promise<string[]> {
  let kandidatenIds: string[];
  if (typ === "erwaehnung") {
    kandidatenIds = [...new Set(e.erwaehnteIds ?? [])];
  } else if (typ === "kommentar") {
    // Verantwortliche des Objekts plus bisherige Kommentatoren des Verlaufs (ohne diesen Kommentar).
    const bezug = k.biomassestromId
      ? eq(kommentar.biomassestromId, k.biomassestromId)
      : k.outputBedarfId
        ? eq(kommentar.outputBedarfId, k.outputBedarfId)
        : eq(kommentar.akteurId, k.akteurId!);
    const kommentatoren = await tx
      .select({ autorId: kommentar.autorId })
      .from(kommentar)
      .where(and(bezug, ne(kommentar.id, e.entitaetId)));
    kandidatenIds = [...new Set([...(await verantwortlicheDesObjekts(tx, k)), ...kommentatoren.map((z) => z.autorId)])];
  } else {
    return [];
  }
  if (kandidatenIds.length === 0) return [];
  const kandidaten = await tx
    .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
    .from(benutzer)
    .where(inArray(benutzer.id, kandidatenIds));
  // Dieselbe Regel wie „Aenderung an meinem Eintrag": nie der Ausloeser (Autor), nie Deaktivierte, nie Betrachter.
  return filtereEmpfaenger(kandidatenIds, kandidaten, e.ausloeserId);
}

/**
 * AP2.6 PR c (E71): Zustellung eines Kommentar-Ereignisses — je Kommentar und
 * Empfaenger ein Eintrag (keine Buendelung, kein Upsert), Objektbezug
 * kommentar_id. Register-Reihenfolge: erwaehnung vor kommentar — wer erwaehnt
 * ist, bekommt nur die Erwaehnung (D6). Beim Bearbeiten entsteht nur
 * erwaehnung fuer die neu Erwaehnten (Register: kommentar nur bei erstellt).
 */
export async function zustelleKommentar(tx: Schreiber, e: ZustellEreignis): Promise<number> {
  const typen = typenFuerArt(e.art);
  if (!typen.length) return 0;
  const [k] = await tx
    .select({ biomassestromId: kommentar.biomassestromId, outputBedarfId: kommentar.outputBedarfId, akteurId: kommentar.akteurId })
    .from(kommentar)
    .where(eq(kommentar.id, e.entitaetId));
  if (!k) return 0;
  const jetzt = new Date();
  const bedient = new Set<string>();
  let gesamt = 0;
  for (const typ of typen) {
    const empfaenger = (await kommentarEmpfaenger(tx, e, k, typ)).filter((id) => !bedient.has(id));
    for (const empfaengerId of empfaenger) {
      bedient.add(empfaengerId);
      gesamt += 1;
      await tx.insert(inboxEintrag).values({
        empfaengerId,
        ausloeserId: e.ausloeserId,
        typ,
        kommentarId: e.entitaetId,
        ereignisId: e.id,
        anzahl: 1,
        erstelltAm: jetzt,
        aktualisiertAm: jetzt,
        zustand: "offen" as const,
        zustandSeit: jetzt,
        notiz: null,
        aufgabe: null,
      });
    }
  }
  return gesamt;
}

/** Buendelungsschluessel je Typ — muss die Praedikate der Indizes in schema.ts spiegeln. */
function buendelung(typ: InboxTyp, zielSpalte: typeof inboxEintrag.biomassestromId | typeof inboxEintrag.outputBedarfId) {
  switch (typ) {
    case "aenderung_eintrag":
      return {
        target: [inboxEintrag.empfaengerId, zielSpalte],
        where: sql`${inboxEintrag.zustand} = 'offen' and ${inboxEintrag.typ} = 'aenderung_eintrag' and ${zielSpalte} is not null`,
      };
    case "zugriffsanfrage":
      return {
        target: [inboxEintrag.empfaengerId, zielSpalte, inboxEintrag.ausloeserId],
        // Muss dem Index-Praedikat entsprechen (inbox_typ_text, Migration 0028).
        where: sql`${inboxEintrag.zustand} = 'offen' and inbox_typ_text(${inboxEintrag.typ}) = 'zugriffsanfrage' and ${zielSpalte} is not null`,
      };
    case "pruefauftrag":
      return {
        target: [inboxEintrag.empfaengerId, zielSpalte],
        // Index-Praedikat aus Migration 0032 (inbox_typ_text).
        where: sql`${inboxEintrag.zustand} = 'offen' and inbox_typ_text(${inboxEintrag.typ}) = 'pruefauftrag' and ${zielSpalte} is not null`,
      };
    default:
      return null;
  }
}

/**
 * AP2.7 PR c (E67): EIN Eintrag je Lauf an alle aktiven Pruefer und Admins,
 * gebuendelt ueber den partiellen Unique-Index inbox_eintrag_import_uidx
 * (Empfaenger, Typ, Lauf) — ein zweiter Abschluss desselben Laufs (Nacharbeit,
 * weiterer Stapel) erhoeht anzahl und setzt den Eintrag wieder ungelesen.
 * Einzige Schreibstelle fuer diesen Typ (inbox-check).
 */
export async function stelleImportAbschlussZu(
  tx: Schreiber,
  e: { importLaufId: string; ausloeserId: string; ereignisId: string; importiert: number },
): Promise<number> {
  const empfaenger = await tx
    .select({ id: benutzer.id })
    .from(benutzer)
    .where(and(inArray(benutzer.rolle, ["pruefer", "admin"]), eq(benutzer.aktiv, true)));
  const jetzt = new Date();
  for (const { id: empfaengerId } of empfaenger) {
    await tx
      .insert(inboxEintrag)
      .values({
        empfaengerId,
        ausloeserId: e.ausloeserId,
        typ: "import_abgeschlossen",
        importLaufId: e.importLaufId,
        ereignisId: e.ereignisId,
        anzahl: Math.max(1, e.importiert),
        erstelltAm: jetzt,
        aktualisiertAm: jetzt,
        zustand: "offen",
        zustandSeit: jetzt,
      })
      .onConflictDoUpdate({
        target: [inboxEintrag.empfaengerId, inboxEintrag.typ, inboxEintrag.importLaufId],
        // Muss dem Index-Praedikat entsprechen (inbox_typ_text, Migration 0043).
        targetWhere: sql`inbox_typ_text(${inboxEintrag.typ}) = 'import_abgeschlossen' and ${inboxEintrag.importLaufId} is not null`,
        set: { anzahl: sql`${inboxEintrag.anzahl} + ${Math.max(1, e.importiert)}`, ausloeserId: e.ausloeserId, ereignisId: e.ereignisId, aktualisiertAm: jetzt, gelesenAm: null, zustand: "offen", zustandSeit: jetzt },
      });
  }
  return empfaenger.length;
}
