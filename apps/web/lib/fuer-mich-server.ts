/**
 * E56: Die Beteiligungen einer Person als EINE Menge aus dem Protokoll —
 * dieselben Arten wie beteiligteAus() (lib/protokoll/ableitung.ts).
 * Gemessen (EXPLAIN auf der Preview, PR E56): ein Seq Scan ueber das
 * Protokoll, hashed; kein Index noetig, solange aenderung klein bleibt.
 */
import { aenderung } from "@bhyo/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import type { AppDb } from "@/lib/db";
import { BETEILIGUNGS_ARTEN } from "@/lib/protokoll/ableitung";
import type { StromArt } from "@/lib/stroeme-modell";

export async function ladeBeteiligungen(db: Pick<AppDb, "selectDistinct">, nutzerId: string, art: StromArt): Promise<Set<string>> {
  const zeilen = await db
    .selectDistinct({ id: aenderung.entitaetId })
    .from(aenderung)
    .where(
      and(
        eq(aenderung.benutzerId, nutzerId),
        eq(aenderung.entitaetTyp, art === "biomasse" ? "biomassestrom" : "output_bedarf"),
        inArray(aenderung.art, [...BETEILIGUNGS_ARTEN]),
      ),
    );
  return new Set(zeilen.map((z) => z.id));
}
