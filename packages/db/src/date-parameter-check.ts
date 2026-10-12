/**
 * Fehlerklasse „Date-Objekt im sql-Template" (Eric 12.10.2026): dritter Fall
 * nach den Proben in #215/#223 und dem Roundup-Job (Lauf 38255670920,
 * ERR_INVALID_ARG_TYPE „Received an instance of Date"). Dieser Check schickt
 * ueber Drizzle ein Date OHNE Spaltenzuordnung durch den echten Bind der
 * Wegwerf-DB — genau der Weg, auf dem der Roundup brach. Rot vor der
 * Absicherung in createSql, gruen danach. Nur lesen, nichts bleibt liegen.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import { createSql } from "./client";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });

async function main() {
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };
  const datum = new Date("2026-10-12T05:07:19.000Z");
  // 1: Date als Parameter mit abgeleitetem Typ timestamptz (kein Cast, keine Spalte).
  const [a] = (await db.execute(sql`select ${datum} = '2026-10-12T05:07:19Z'::timestamptz as gleich, pg_typeof(${datum})::text as typ`)) as unknown as { gleich: boolean; typ: string }[];
  pruefe("1 Date ohne Cast kommt als timestamptz an und ist gleich", a?.gleich === true && a?.typ === "timestamp with time zone", a);
  // 2: Der Roundup-Fall — Date im filter-Ausdruck gegen eine timestamptz-Spalte.
  const [b] = (await db.execute(sql`select count(*) filter (where ${schema.inboxEintrag.erstelltAm} > ${datum})::int as n from ${schema.inboxEintrag}`)) as unknown as { n: number }[];
  pruefe("2 Date im filter (where spalte > date) laeuft (Roundup-Fall)", typeof b?.n === "number", b);
  // 3: Date mit ausdruecklichem Cast auf date und null bleiben unveraendert moeglich.
  const [c] = (await db.execute(sql`select ${datum}::date = '2026-10-12'::date as tag, ${null}::timestamptz is null as leer`)) as unknown as { tag: boolean; leer: boolean }[];
  pruefe("3 Date mit ::date und null", c?.tag === true && c?.leer === true, c);
  if (fehler.length) {
    console.error(`DATE-PARAMETER-CHECK ROT — ${fehler.join("; ")}`);
    process.exit(1);
  }
  console.log("DATE-PARAMETER-CHECK OK — Date-Parameter kommen ueber Drizzle als Zeitstempel an.");
}

main()
  .catch((e) => {
    const kette: string[] = [];
    for (let f: unknown = e; f instanceof Error && kette.length < 5; f = f.cause) kette.push(`${f.name}: ${f.message}${"code" in f ? ` (code ${String((f as { code?: unknown }).code)})` : ""}`);
    console.error("DATE-PARAMETER-CHECK FEHLER:", kette.join("\n  <- "));
    process.exit(1);
  })
  .finally(() => verbindung.end().catch(() => {}));
