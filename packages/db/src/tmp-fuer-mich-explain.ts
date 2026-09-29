/** TEMPORAER (E56): EXPLAIN ANALYZE der „Für mich"-Abfrage, nur lesen. */
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!, { max: 1, fetch_types: false });
const ME = "(select id from benutzer where email = 'eric.schmitt@bhyo.de')";
for (const [tabelle, typ, spalte] of [["biomassestrom", "biomassestrom", "biomassestrom_id"], ["output_bedarf", "output_bedarf", "output_bedarf_id"]] as const) {
  const [n] = await sql.unsafe(`select count(*)::int as n from ${tabelle}`);
  const [na] = await sql.unsafe(`select count(*)::int as n from aenderung where entitaet_typ = '${typ}'`);
  console.log(`TABELLE ${tabelle} zeilen=${n!.n} protokollzeilen=${na!.n}`);
  const abfrage = `select s.id from ${tabelle} s
     where s.gesperrt_von = ${ME}
        or exists (select 1 from strom_zuweisung z where z.${spalte} = s.id and z.nutzer_id = ${ME})
        or exists (select 1 from aenderung a where a.entitaet_typ = '${typ}' and a.entitaet_id = s.id
                     and a.benutzer_id = ${ME}
                     and a.art in ('angelegt','geaendert','status_gesetzt','verworfen'))`;
  const plan = await sql.unsafe(`explain (analyze, buffers, format text) ${abfrage}`);
  for (const z of plan) console.log("PLAN " + Object.values(z)[0]);
  const [t] = await sql.unsafe(`select count(*)::int as n from (${abfrage}) x`);
  console.log(`TREFFER ${tabelle} fuer_mich=${t!.n}`);
}
const idx = await sql`select indexname from pg_indexes where tablename in ('aenderung','strom_zuweisung') order by indexname`;
console.log("INDIZES " + JSON.stringify(idx.map((i) => i.indexname)));
await sql.end();
