/**
 * Fuehrt eine SQL-Datei gegen DATABASE_URL aus (postgres-js `sql.file`).
 * Gedacht fuer Fixtures der Wegwerf-Postgres in der CI (E68 PR 1) — die
 * Runner haben kein psql. Zielnachweis vor dem Lauf wie bei den DB-Checks;
 * gegen Production ist der Aufruf nicht vorgesehen und wird abgewiesen.
 *
 * Aufruf: tsx src/sql-datei.ts <pfad>
 */
import { resolve } from "node:path";

import postgres from "postgres";

const url = process.env.DATABASE_URL;
const pfad = process.argv[2];
if (!url || !pfad) {
  console.error("Aufruf: DATABASE_URL=… tsx src/sql-datei.ts <pfad>");
  process.exit(2);
}
const ziel = new URL(url);
if (ziel.hostname.startsWith("ep-purple-glade")) {
  console.error("::error::sql-datei gegen Production ist nicht vorgesehen. Abbruch.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, fetch_types: false });

void (async () => {
  console.log(`SQLDATEI host=${ziel.hostname} db=${ziel.pathname.slice(1)} datei=${pfad}`);
  try {
    await sql.file(resolve(pfad));
    console.log("SQL-Datei ausgefuehrt.");
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
})();
