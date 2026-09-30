/**
 * AP2.3 PR b (E59): Lesen der Sektorliste fuer den Reiter „Referenzlisten" —
 * jeder Sektor mit der Zahl seiner Akteure (Verwendungen). Deaktivierte
 * bleiben in der Liste; ausgewaehlt werden koennen nur aktive.
 */
import { akteur, sektor } from "@bhyo/db/schema";
import { asc, eq, sql } from "drizzle-orm";

import type { AppDb } from "@/lib/db";

export interface SektorZeile {
  id: string;
  code: string;
  label: string;
  aktiv: boolean;
  verwendungen: number;
}

export async function ladeSektorUebersicht(db: Pick<AppDb, "select">): Promise<SektorZeile[]> {
  const zeilen = await db
    .select({
      id: sektor.id,
      code: sektor.code,
      label: sektor.label,
      aktiv: sektor.aktiv,
      verwendungen: sql<unknown>`count(${akteur.id})`,
    })
    .from(sektor)
    .leftJoin(akteur, eq(akteur.sektor, sektor.code))
    .groupBy(sektor.id, sektor.code, sektor.label, sektor.aktiv, sektor.sortierung)
    .orderBy(asc(sektor.sortierung), asc(sektor.label));
  // count() kommt ueber den Worker-Treiber als Text an (siehe stroeme-zeilen.ts).
  return zeilen.map((z) => ({ ...z, verwendungen: Number(z.verwendungen) }));
}
