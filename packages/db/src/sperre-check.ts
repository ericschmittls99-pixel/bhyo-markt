/**
 * E44 (AP2.1 PR b): dauerhafter DB-Check der Sperren — laeuft im Deploy-CI
 * gegen die echte Preview-DB (wie benutzer-check). Zusicherungen:
 *
 * 1. Die Rolle pruefer existiert im Enum benutzer_rolle.
 * 2. biomassestrom und output_bedarf tragen gesperrt_von / gesperrt_am mit dem
 *    CHECK "beide NULL oder beide gesetzt" — und der CHECK GREIFT: ein UPDATE,
 *    das nur gesperrt_am setzt, muss scheitern.
 * 3. strom_zuweisung existiert mit CHECK "genau ein Strom" — und der greift:
 *    ein INSERT ohne Strombezug muss scheitern. Die partiellen Unique-Indizes
 *    stehen.
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
      // Kam die Probe durch, ist der CHECK wirkungslos — trotzdem nichts behalten.
      throw new Error("__durchgekommen__");
    });
    return false;
  } catch (e) {
    return !(e instanceof Error && e.message === "__durchgekommen__");
  }
}

async function main() {
  const ziel = new URL(url!);
  console.log(`SPERRECHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Enum
  const enumWerte = (
    await sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'benutzer_rolle' order by e.enumsortorder`
  ).map((r) => r.enumlabel as string);
  console.log(`ROLLEN ${enumWerte.join(",")}`);
  if (!enumWerte.includes("pruefer")) fehler.push("Enum benutzer_rolle kennt pruefer nicht");

  // (2) Spalten + CHECKs vorhanden
  for (const tabelle of ["biomassestrom", "output_bedarf"]) {
    const spalten = (
      await sql`select column_name from information_schema.columns where table_name = ${tabelle} and column_name in ('gesperrt_von', 'gesperrt_am')`
    ).map((r) => r.column_name as string);
    if (spalten.length !== 2) fehler.push(`${tabelle}: gesperrt_von/gesperrt_am fehlen (${spalten.join(",") || "keine"})`);
    const [c] = await sql`select count(*)::int as n from pg_constraint where conname = ${tabelle + "_sperre_check"} and contype = 'c'`;
    if (!c || c.n !== 1) fehler.push(`${tabelle}: CHECK ${tabelle}_sperre_check fehlt`);
    // Greift er? Nur gesperrt_am setzen muss scheitern (Probe auf einer vorhandenen Zeile).
    const [zeile] = await sql`select id from ${sql(tabelle)} limit 1`;
    if (zeile) {
      const abgewiesen = await scheitert((tx) => tx`update ${tx(tabelle)} set gesperrt_am = now() where id = ${zeile.id}`);
      console.log(`${tabelle.toUpperCase()}_HALBE_SPERRE_ABGEWIESEN ${abgewiesen}`);
      if (!abgewiesen) fehler.push(`${tabelle}: CHECK beide-NULL-oder-beide-gesetzt greift nicht`);
    } else {
      console.log(`${tabelle}: keine Zeile fuer die CHECK-Probe (Tabelle leer) — nur Existenz geprueft`);
    }
  }

  // (3) strom_zuweisung
  const [zt] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'strom_zuweisung'`;
  if (!zt || zt.n !== 1) fehler.push("Tabelle strom_zuweisung fehlt");
  else {
    const [b] = await sql`select id from benutzer limit 1`;
    if (b) {
      const abgewiesen = await scheitert(
        (tx) => tx`insert into strom_zuweisung (nutzer_id, zugewiesen_von) values (${b.id}, ${b.id})`,
      );
      console.log(`ZUWEISUNG_OHNE_STROM_ABGEWIESEN ${abgewiesen}`);
      if (!abgewiesen) fehler.push("strom_zuweisung: CHECK genau-ein-Strom greift nicht");
    }
    const idx = (
      await sql`select indexname from pg_indexes where tablename = 'strom_zuweisung' and indexname in ('strom_zuweisung_biomasse_nutzer_uidx', 'strom_zuweisung_output_nutzer_uidx')`
    ).length;
    if (idx !== 2) fehler.push(`strom_zuweisung: partielle Unique-Indizes fehlen (${idx} von 2)`);
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::SPERRE-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Sperre-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
