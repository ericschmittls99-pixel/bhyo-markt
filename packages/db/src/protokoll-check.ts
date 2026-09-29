/**
 * AP2.2 PR a: dauerhafter DB-Check des Ereignisprotokolls — laeuft im
 * Deploy-CI gegen die echte Preview-DB (wie sperre-check). Zusicherungen:
 *
 * 1. Enum ereignis_art und die Spalten art / benutzer_id stehen (Migration 0026).
 * 2. Der CHECK aenderung_urheber_check GREIFT: eine neue Zeile mit einer Art
 *    ausser altbestand und OHNE benutzer_id muss abgewiesen werden.
 * 3. Rollback = kein Ereignis: eine gueltige Zeile in einer zurueckgerollten
 *    Transaktion hinterlaesst nichts.
 * 4. Bestand: keine Zeile ohne Art; jede Zeile ausser altbestand hat einen Urheber.
 *
 * Schreibt nichts Bleibendes: jede Probe laeuft in einer Transaktion, die
 * zurueckgerollt wird.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

async function scheitert(probe: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<boolean> {
  try {
    await sql.begin(async (tx) => {
      await probe(tx);
      throw new Error("__durchgekommen__");
    });
    return false;
  } catch (e) {
    return !(e instanceof Error && e.message === "__durchgekommen__");
  }
}

async function main() {
  const ziel = new URL(url!);
  console.log(`PROTOKOLLCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Strukturen
  const spalten = await sql`
    select column_name from information_schema.columns
     where table_name = 'aenderung' and column_name in ('art', 'benutzer_id')`;
  const [enumZeile] = await sql`select count(*)::int as n from pg_type where typname = 'ereignis_art'`;
  const [checkZeile] = await sql`select count(*)::int as n from pg_constraint where conname = 'aenderung_urheber_check'`;
  console.log(`STRUKTUR spalten=${spalten.length}/2 enum=${enumZeile!.n} check=${checkZeile!.n}`);
  if (spalten.length !== 2 || enumZeile!.n !== 1) {
    fehler.push("Migration 0026 fehlt (art/benutzer_id/ereignis_art)");
    console.error(fehler.join("; "));
    await sql.end();
    process.exit(1);
  }
  if (checkZeile!.n !== 1) fehler.push("CHECK aenderung_urheber_check fehlt");

  // (2) CHECK muss greifen.
  const ohneUrheberAbgewiesen = await scheitert(
    (tx) => tx`insert into aenderung (entitaet_typ, entitaet_id, text, art)
               values ('probe', gen_random_uuid(), 'protokoll-check', 'geaendert')`,
  );
  console.log(`OHNE_URHEBER_ABGEWIESEN ${ohneUrheberAbgewiesen}`);
  if (!ohneUrheberAbgewiesen) fehler.push("neue Zeile ohne benutzer_id kam durch — CHECK greift nicht");

  // (3) Rollback = kein Ereignis.
  const [vorher] = await sql`select count(*)::int as n from aenderung`;
  const [irgendwer] = await sql`select id from benutzer limit 1`;
  if (irgendwer) {
    await scheitert(
      (tx) => tx`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id)
                 values ('probe', gen_random_uuid(), 'protokoll-check rollback', 'geaendert', ${irgendwer.id})`,
    );
  }
  const [nachher] = await sql`select count(*)::int as n from aenderung`;
  console.log(`ROLLBACK vorher=${vorher!.n} nachher=${nachher!.n}`);
  if (vorher!.n !== nachher!.n) fehler.push("Zeile aus zurueckgerollter Transaktion blieb stehen");

  // (4) Bestand
  const [b] = await sql`
    select count(*)::int as zeilen,
           count(*) filter (where art is null)::int as ohne_art,
           count(*) filter (where art <> 'altbestand' and benutzer_id is null)::int as neu_ohne_urheber,
           count(*) filter (where art = 'altbestand')::int as altbestand
      from aenderung`;
  console.log("BESTAND " + JSON.stringify(b));
  if (b!.ohne_art > 0) fehler.push(`${b!.ohne_art} Zeile(n) ohne Art`);
  if (b!.neu_ohne_urheber > 0) fehler.push(`${b!.neu_ohne_urheber} Zeile(n) ausser altbestand ohne benutzer_id`);

  await sql.end();
  if (fehler.length) {
    console.error("PROTOKOLLCHECK FEHLER: " + fehler.join("; "));
    process.exit(1);
  }
  console.log("PROTOKOLLCHECK OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
