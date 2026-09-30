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
import { benutzer, biomassestrom, inboxEintrag, outputBedarf } from "@bhyo/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

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
      // Beteiligte aus dem Protokoll (inklusive des gerade geschriebenen Ereignisses).
      const beteiligte = beteiligteAus(await protokollZeilen(tx, e.entitaet, e.entitaetId));
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
      // Die betroffene Person — nie der Ausloeser selbst.
      return e.betrifftId && e.betrifftId !== e.ausloeserId ? [e.betrifftId] : [];
    case "pruefauftrag": {
      // E62: alle aktiven Pruefer und Admins (admin ⊇ pruefer), ausser dem Ausloeser.
      const pruefer = await tx
        .select({ id: benutzer.id })
        .from(benutzer)
        .where(and(inArray(benutzer.rolle, ["pruefer", "admin"]), eq(benutzer.aktiv, true)));
      return pruefer.map((p) => p.id).filter((id) => id !== e.ausloeserId);
    }
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
  typ: "zugriffsanfrage" | "pruefauftrag",
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
  const spalte = stromSpalte(e.entitaet);
  if (!spalte) return 0;

  // PR c: Abraeumen VOR dem Zustellen — Zuweisung und Ablehnung erledigen die
  // Anfragen dieser Person, Entsperren alle Anfragen zum Strom (ohne Mitteilung).
  if (e.art === "zugewiesen" && e.betrifftId) await raeumeAb(tx, spalte, e.entitaetId, "zugriffsanfrage", e.betrifftId);
  if (e.art === "zugriff_abgelehnt" && e.betrifftId) await raeumeAb(tx, spalte, e.entitaetId, "zugriffsanfrage", e.betrifftId);
  if (e.art === "entsperrt") await raeumeAb(tx, spalte, e.entitaetId, "zugriffsanfrage");
  // E62: Pruefen, Zurueckgeben und Verwerfen erledigen den Pruefauftrag bei allen Pruefern.
  if (AUFTRAG_ABRAEUMEN_BEI.includes(e.art)) await raeumeAb(tx, spalte, e.entitaetId, "pruefauftrag");

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
