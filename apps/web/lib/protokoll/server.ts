/**
 * Abfrageseite der Ableitung (E23): liest die Protokollzeilen eines Objekts
 * und ueberlaesst die Deutung den reinen Funktionen in ./ableitung.ts.
 */
import { aenderung } from "@bhyo/db/schema";
import { and, eq } from "drizzle-orm";

import type { AppDb } from "@/lib/db";

import { beteiligteAus, erstellerAus, type Ersteller, type ProtokollZeile } from "./ableitung";
import type { Entitaet } from "./index";

export type Leser = Pick<AppDb, "select">;

export async function protokollZeilen(db: Leser, entitaet: Entitaet, id: string): Promise<ProtokollZeile[]> {
  return db
    .select({ art: aenderung.art, benutzerId: aenderung.benutzerId, zeitpunkt: aenderung.zeitpunkt })
    .from(aenderung)
    .where(and(eq(aenderung.entitaetTyp, entitaet), eq(aenderung.entitaetId, id)));
}

export async function ersteller(db: Leser, entitaet: Entitaet, id: string): Promise<Ersteller> {
  return erstellerAus(await protokollZeilen(db, entitaet, id));
}

export async function beteiligte(db: Leser, entitaet: Entitaet, id: string): Promise<string[]> {
  return beteiligteAus(await protokollZeilen(db, entitaet, id));
}
