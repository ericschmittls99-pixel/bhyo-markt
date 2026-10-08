/**
 * AP2.8 (E70, Eric 08.10.2026): Die Staffel der Wird-frei-Hinweise fuer die
 * Oberflaeche — dieselben vier Parameter wie im taeglichen Job
 * (lib/inbox/hinweise.ts), am Stichtag aufgeloest (parameter_wert), dann
 * normalisiert. Eine Groesse, ein Ursprung: Pille und Facette folgen den
 * Parametern, nicht der Standardkonstante.
 */
import { sql } from "drizzle-orm";

import type { AppDb } from "./db";
import { WIRD_FREI_STUFEN_SCHLUESSEL, normalisiereStufen } from "./wird-frei";

export async function ladeWirdFreiStufen(db: Pick<AppDb, "execute">, stichtag: string): Promise<number[]> {
  const rows = (await db.execute(sql`
    select ${sql.join(
      WIRD_FREI_STUFEN_SCHLUESSEL.map((k, i) => sql`parameter_wert(${k}, ${stichtag}::date) as ${sql.raw(`s${i + 1}`)}`),
      sql`, `,
    )}`)) as unknown as Record<string, number | string>[];
  const z = rows[0] ?? {};
  return normalisiereStufen(WIRD_FREI_STUFEN_SCHLUESSEL.map((_, i) => Number(z[`s${i + 1}`])));
}
