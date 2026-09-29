/**
 * Zustellung: wird von `protokolliere` in DERSELBEN Transaktion aufgerufen.
 * Rollback des Schreibpfads = kein Ereignis = keine Zustellung. Dies ist die
 * einzige Stelle, die inbox_eintrag beim Zustellen schreibt (Upsert).
 */
import { benutzer, inboxEintrag } from "@bhyo/db/schema";
import { inArray, sql } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { beteiligteAus } from "@/lib/protokoll/ableitung";
import { protokollZeilen } from "@/lib/protokoll/server";
import type { Entitaet, EreignisArt } from "@/lib/protokoll";

import { filtereEmpfaenger } from "./empfaenger";
import { typFuerArt } from "./register";

export type Schreiber = Pick<AppDb, "insert" | "select">;

export interface ZustellEreignis {
  id: string;
  art: EreignisArt;
  entitaet: Entitaet;
  entitaetId: string;
  ausloeserId: string;
}

function stromSpalte(entitaet: Entitaet): "biomassestromId" | "outputBedarfId" | null {
  if (entitaet === "biomassestrom") return "biomassestromId";
  if (entitaet === "output_bedarf") return "outputBedarfId";
  return null;
}

/** Empfaenger eines Ereignisses laut Register — leer, wenn der Typ nicht zustellt. */
export async function empfaengerFuer(tx: Schreiber, e: ZustellEreignis): Promise<string[]> {
  const typ = typFuerArt(e.art);
  if (!typ || !stromSpalte(e.entitaet)) return [];
  // Beteiligte aus dem Protokoll (inklusive des gerade geschriebenen Ereignisses).
  const beteiligte = beteiligteAus(await protokollZeilen(tx, e.entitaet, e.entitaetId));
  if (beteiligte.length === 0) return [];
  const kandidaten = await tx
    .select({ id: benutzer.id, rolle: benutzer.rolle, aktiv: benutzer.aktiv })
    .from(benutzer)
    .where(inArray(benutzer.id, beteiligte));
  return filtereEmpfaenger(beteiligte, kandidaten, e.ausloeserId);
}

export async function zustellen(tx: Schreiber, e: ZustellEreignis): Promise<number> {
  const typ = typFuerArt(e.art);
  const spalte = stromSpalte(e.entitaet);
  if (!typ || !spalte) return 0;
  const empfaenger = await empfaengerFuer(tx, e);
  const jetzt = new Date();
  for (const empfaengerId of empfaenger) {
    // Buendelung per DB: Konflikt auf dem partiellen Unique-Index (offen,
    // aenderung_eintrag) => anzahl + 1, Ausloeser/Ereignis neu, wieder ungelesen.
    const zielSpalte = spalte === "biomassestromId" ? inboxEintrag.biomassestromId : inboxEintrag.outputBedarfId;
    await tx
      .insert(inboxEintrag)
      .values({
        empfaengerId,
        ausloeserId: e.ausloeserId,
        typ,
        [spalte]: e.entitaetId,
        ereignisId: e.id,
        anzahl: 1,
        erstelltAm: jetzt,
        aktualisiertAm: jetzt,
        zustand: "offen",
        zustandSeit: jetzt,
      })
      .onConflictDoUpdate({
        target: [inboxEintrag.empfaengerId, zielSpalte],
        targetWhere: sql`${inboxEintrag.zustand} = 'offen' and ${inboxEintrag.typ} = 'aenderung_eintrag' and ${zielSpalte} is not null`,
        set: {
          anzahl: sql`${inboxEintrag.anzahl} + 1`,
          ausloeserId: e.ausloeserId,
          ereignisId: e.id,
          aktualisiertAm: jetzt,
          gelesenAm: null,
        },
      });
  }
  return empfaenger.length;
}
