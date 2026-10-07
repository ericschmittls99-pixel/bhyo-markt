"use server";

import { beleg, biomassestrom, outputBedarf } from "@bhyo/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { heuteBerlin } from "@/lib/datum";
import { withDb } from "@/lib/db";
import { ERLAUBTE_UEBERGAENGE, PRUEF_AUSGANG, STATUS_LABEL } from "@/lib/status";
import { rechtFuerAction } from "@/lib/rechte/wache";
import { pruefeBelegSperre, pruefeStromSperre } from "@/lib/rechte/sperre-server";
import { protokolliere, type EreignisArt } from "@/lib/protokoll";
import type { Zugang } from "@/lib/rechte";
import type { StromArt } from "@/lib/stroeme-modell";

export interface AktionErgebnis {
  ok: boolean;
  fehler?: string;
}

/**
 * Gemeinsamer Rumpf. Bekommt den BEREITS geprueften Zugang uebergeben — die
 * Wache sitzt am Eingang jeder exportierten Aktion, nicht hier drin: Eine
 * Pruefung eine Ebene tiefer sieht man der Signatur nicht an, und
 * scripts/rechte-check.ts sieht sie auch nicht.
 *
 * AP2.4 PR a (E62, 0.4): jeder Statuswechsel mit eigener Ereignisart
 * (in_pruefung_gegeben, zurueckgegeben, reaktiviert, verworfen, geprueft) —
 * strukturiert statt Freitext; status_gesetzt wird nie mehr geschrieben.
 */
async function wechsleStatus(
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  aktion: "strom.status_setzen" | "strom.verwerfen" | "strom.pruefen",
  art: StromArt,
  id: string,
  neu: string,
  erlaubtAus: (status: string) => boolean,
  artFuer: (status: string) => EreignisArt,
  /**
   * AP2.4 PR b: fachliche Vorbedingung am Eingang, in der Transaktion, VOR
   * dem Schreiben — wirft mit der Meldung fuer die Oberflaeche (Beleg-Pflicht
   * beim Pruefen, Entscheidung Eric 01.10.2026).
   */
  vorbedingung?: (zeile: { status: string; belegId: string | null; tsAnteilPct: string | null; aschegehaltPct: string | null }) => void,
): Promise<AktionErgebnis> {
  const email = zugang.email;
  if (!(neu in STATUS_LABEL)) return { ok: false, fehler: "Unbekannter Status." };

  try {
    // Transaktion + optimistische Sperre: Update greift nur, wenn der Status
    // noch dem gelesenen Stand entspricht — sonst prueft der E8-Guard gegen
    // einen veralteten Wert; und Statuswechsel ohne Protokoll darf es nicht geben.
    await withDb((db) =>
      db.transaction(async (tx) => {
        // E44: Objektstufe — Sperre lesen (Zeilensperre) und gegen die Matrix pruefen.
        await pruefeStromSperre(tx, zugang, aktion, art, id);
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const [zeile] = await tx
          .select({
            status: tabelle.status,
            belegId: tabelle.belegId,
            // PR e: Biomasse ohne TS-Anteil/Aschegehalt ist unvollstaendig — Vorbedingung beim Pruefen.
            tsAnteilPct: art === "biomasse" ? biomassestrom.tsAnteilPct : sql<string | null>`null`,
            aschegehaltPct: art === "biomasse" ? biomassestrom.aschegehaltPct : sql<string | null>`null`,
          })
          .from(tabelle)
          .where(eq(tabelle.id, id))
          .limit(1);
        if (!zeile) throw new Error("Datensatz nicht gefunden.");
        vorbedingung?.(zeile);
        if (zeile.status === neu)
          throw new Error(`Der Strom ist bereits „${STATUS_LABEL[neu]}".`);
        if (!erlaubtAus(zeile.status))
          throw new Error(
            `Wechsel von „${STATUS_LABEL[zeile.status]}" nach „${STATUS_LABEL[neu]}" ist nicht vorgesehen.`,
          );
        const geaendert = await tx
          .update(tabelle)
          .set({ status: neu as never, updatedAt: new Date() })
          .where(and(eq(tabelle.id, id), eq(tabelle.status, zeile.status)))
          .returning({ id: tabelle.id });
        if (!geaendert.length)
          throw new Error("Der Status wurde zwischenzeitlich geändert — bitte neu laden.");
        await protokolliere(tx, {
          art: artFuer(zeile.status) as Exclude<EreignisArt, "altbestand">,
          entitaet: art === "biomasse" ? "biomassestrom" : "output_bedarf",
          id,
          benutzerId: zugang.id,
          benutzerEmail: email,
        });
      }),
    );
  } catch (e) {
    return {
      ok: false,
      fehler: e instanceof Error ? e.message : "Speichern fehlgeschlagen.",
    };
  }

  revalidatePath("/register");
  return { ok: true };
}

/**
 * Statuswechsel im Detail-Kopf (E8, E62): In Pruefung geben, Zurueckgeben,
 * Reaktivieren — ab bearbeiter. „geprueft" geht hier nicht durch (stromPruefen).
 */
export async function statusSetzen(
  art: StromArt,
  id: string,
  neu: string,
): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.status_setzen");
  if ("fehler" in wache) return wache;
  return wechsleStatus(
    wache.zugang,
    "strom.status_setzen",
    art,
    id,
    neu,
    (status) => (ERLAUBTE_UEBERGAENGE[status] ?? []).includes(neu),
    // Ereignisart je Uebergang (0.4), als Literale — so sieht protokoll-check sie:
    // nach in_pruefung = in_pruefung_gegeben; zurueck in den Entwurf aus der
    // Pruefung = zurueckgegeben, aus verworfen = reaktiviert.
    (status) => (neu === "in_pruefung" ? "in_pruefung_gegeben" : status === "verworfen" ? "reaktiviert" : "zurueckgegeben"),
  );
}

/**
 * Verwerfen-Flow (Entscheidung E2): UI wie der Mockup-Loesch-Flow, die Aktion
 * setzt aber status = verworfen — es wird NIE physisch geloescht (CLAUDE.md).
 * Verwerfen ist aus jedem Status erlaubt (Papierkorb).
 */
export async function stromVerwerfen(
  art: StromArt,
  id: string,
): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.verwerfen");
  if ("fehler" in wache) return wache;
  return wechsleStatus(wache.zugang, "strom.verwerfen", art, id, "verworfen", () => true, () => "verworfen");
}

/** Meldung der Beleg-Pflicht (PR b, Entscheidung Eric 01.10.2026) — Pruefen und erneut Verifizieren. */
const OHNE_BELEG = "Ohne Beleg kann nicht geprüft werden.";
/** PR e (Eric 07.10.2026): ohne TS-Anteil und Aschegehalt kein „geprueft" — dieselbe Regel als DB-CHECK (Migration 0047). */
export const UNVOLLSTAENDIG = "TS-Anteil und Aschegehalt fehlen — erst ergänzen, dann prüfen.";

/**
 * AP2.4 PR a (E62, D4): „geprueft" setzen — nur pruefer/admin, aus entwurf
 * (direkt) und in_pruefung. Das Ereignis geprueft ist der Pruefzeitpunkt, an
 * dem strom_verifikation() die Frist rechnet. PR b: ohne Beleg abgewiesen —
 * bestehende geprüfte Ströme ohne Beleg tragen den Zustand ohne_beleg.
 */
export async function stromPruefen(art: StromArt, id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.pruefen");
  if ("fehler" in wache) return wache;
  return wechsleStatus(
    wache.zugang,
    "strom.pruefen",
    art,
    id,
    "geprueft",
    (status) => PRUEF_AUSGANG.includes(status),
    () => "geprueft",
    (zeile) => {
      if (!zeile.belegId) throw new Error(OHNE_BELEG);
      if (art === "biomasse" && (zeile.tsAnteilPct == null || zeile.aschegehaltPct == null)) throw new Error(UNVOLLSTAENDIG);
    },
  );
}

/** Belegtypen, deren Frist gueltig_bis ist (strom_verifikation(), Migration 0032). */
const TYPEN_MIT_GUELTIG_BIS: readonly string[] = ["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"];

/**
 * AP2.4 PR b (E63): erneut verifizieren — nur pruefer/admin, nur an einem
 * geprüften Strom mit Beleg. Kein Statuswechsel: das Ereignis reverifiziert
 * ist der neue Prueftag, ab dem strom_verifikation() die Typ-Frist rechnet;
 * die Hinweise des Jobs zu diesem Strom werden in der Zustellung abgeraeumt.
 *
 * D3-Regeln: Ist der Beleg als abgelaufen markiert, geht es erst nach dem
 * Aufheben. Ist bei den gueltig_bis-Typen das Datum erreicht, hilft keine
 * Bestaetigung — nur ein neues gueltig_bis nach heute oder ein anderer
 * Belegtyp (fachliche Aenderung → Ruecksetzen → normaler Pruefweg) oder die
 * Markierung „abgelaufen".
 */
export async function stromReverifizieren(art: StromArt, id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("strom.reverifizieren");
  if ("fehler" in wache) return wache;
  const { zugang } = wache;
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await pruefeStromSperre(tx, zugang, "strom.reverifizieren", art, id);
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const [zeile] = await tx
          .select({ status: tabelle.status, belegId: tabelle.belegId })
          .from(tabelle)
          .where(eq(tabelle.id, id))
          .limit(1);
        if (!zeile) throw new Error("Datensatz nicht gefunden.");
        if (!zeile.belegId) throw new Error(OHNE_BELEG);
        if (zeile.status !== "geprueft")
          throw new Error(`Erneut verifizieren geht nur an geprüften Strömen — dieser ist „${STATUS_LABEL[zeile.status]}".`);
        const [b] = await tx
          .select({ typ: beleg.typ, gueltigBis: beleg.gueltigBis, abgelaufenAm: beleg.abgelaufenAm })
          .from(beleg)
          .where(eq(beleg.id, zeile.belegId))
          .limit(1);
        if (!b) throw new Error("Der Beleg wurde nicht gefunden.");
        if (b.abgelaufenAm) throw new Error("Der Beleg ist als abgelaufen markiert — bitte erst die Markierung aufheben.");
        if (TYPEN_MIT_GUELTIG_BIS.includes(b.typ) && (!b.gueltigBis || b.gueltigBis <= heuteBerlin()))
          throw new Error(
            "Gültig bis ist erreicht — bitte ein neues Gültig-bis nach heute eintragen, den Belegtyp wechseln oder den Beleg als abgelaufen markieren.",
          );
        await tx.update(tabelle).set({ updatedAt: new Date() }).where(eq(tabelle.id, id));
        await protokolliere(tx, {
          art: "reverifiziert",
          entitaet: art === "biomasse" ? "biomassestrom" : "output_bedarf",
          id,
          benutzerId: zugang.id,
          benutzerEmail: zugang.email,
        });
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Speichern fehlgeschlagen." };
  }
  revalidatePath("/register");
  revalidatePath("/inbox");
  return { ok: true };
}

/**
 * AP2.4 PR a (E62, D3): Beleg als abgelaufen markieren bzw. die Markierung
 * aufheben — eine Eingabe des Pruefers, gespeichert in beleg.abgelaufen_am.
 * Objekt ist der Strom (Sperre, Protokoll, Inbox); der Beleg kann geteilt
 * sein, deshalb zusaetzlich die Belegsperre (alle Referenzen).
 */
async function abgelaufenSetzen(
  zugang: Extract<Zugang, { art: "erlaubt" }>,
  aktion: "beleg.abgelaufen_markieren" | "beleg.abgelaufen_aufheben",
  art: StromArt,
  id: string,
  markieren: boolean,
): Promise<AktionErgebnis> {
  try {
    await withDb((db) =>
      db.transaction(async (tx) => {
        await pruefeStromSperre(tx, zugang, aktion, art, id);
        const tabelle = art === "biomasse" ? biomassestrom : outputBedarf;
        const [zeile] = await tx.select({ belegId: tabelle.belegId }).from(tabelle).where(eq(tabelle.id, id)).limit(1);
        if (!zeile) throw new Error("Datensatz nicht gefunden.");
        if (!zeile.belegId) throw new Error("Der Strom hat keinen Beleg.");
        await pruefeBelegSperre(tx, zugang, zeile.belegId);
        const [b] = await tx.select({ abgelaufenAm: beleg.abgelaufenAm }).from(beleg).where(eq(beleg.id, zeile.belegId)).limit(1);
        if (!b) throw new Error("Beleg nicht gefunden.");
        if (markieren && b.abgelaufenAm) throw new Error("Der Beleg ist bereits als abgelaufen markiert.");
        if (!markieren && !b.abgelaufenAm) throw new Error("Der Beleg ist nicht als abgelaufen markiert.");
        await tx
          .update(beleg)
          .set({ abgelaufenAm: markieren ? heuteBerlin() : null })
          .where(eq(beleg.id, zeile.belegId));
        await protokolliere(tx, {
          art: markieren ? "als_abgelaufen_markiert" : "abgelaufen_aufgehoben",
          entitaet: art === "biomasse" ? "biomassestrom" : "output_bedarf",
          id,
          benutzerId: zugang.id,
          benutzerEmail: zugang.email,
        });
      }),
    );
  } catch (e) {
    return { ok: false, fehler: e instanceof Error ? e.message : "Speichern fehlgeschlagen." };
  }
  revalidatePath("/register");
  return { ok: true };
}

export async function belegAbgelaufenMarkieren(art: StromArt, id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("beleg.abgelaufen_markieren");
  if ("fehler" in wache) return wache;
  return abgelaufenSetzen(wache.zugang, "beleg.abgelaufen_markieren", art, id, true);
}

export async function belegAbgelaufenAufheben(art: StromArt, id: string): Promise<AktionErgebnis> {
  const wache = await rechtFuerAction("beleg.abgelaufen_aufheben");
  if ("fehler" in wache) return wache;
  return abgelaufenSetzen(wache.zugang, "beleg.abgelaufen_aufheben", art, id, false);
}
