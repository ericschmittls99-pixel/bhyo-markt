/**
 * Backup MIT Zaehlprotokoll (E37-Nachtrag): oeffnet eine Transaktion
 * REPEATABLE READ, exportiert den Snapshot, zaehlt darin jede Tabelle und den
 * Migrationsstand und laesst pg_dump mit --snapshot GENAU diesen Stand
 * sichern. Dump und Protokoll gehoeren damit zum selben Moment; der Restore
 * vergleicht spaeter gegen das Protokoll statt gegen die laufende Production.
 *
 * Aufruf: DATABASE_URL=... tsx src/backup-zaehlung.ts <dump-datei>
 * Schreibt <dump-datei> und <dump-datei ohne .dump>.zaehlung.json.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

import postgres from "postgres";

import { protokollName, type Zaehlprotokoll } from "./zaehlprotokoll";

const url = process.env.DATABASE_URL;
const dump = process.argv[2];
if (!url || !dump) {
  console.error("DATABASE_URL und Dump-Dateiname sind Pflicht.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

function pgDump(snapshot: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, "--dbname", url!, "--file", dump!],
      { stdio: "inherit" },
    );
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump Exit ${code}`))));
    p.on("error", reject);
  });
}

async function main() {
  const protokoll = await sql.begin("isolation level repeatable read read only", async (tx) => {
    const [s] = await tx`select pg_export_snapshot() as snapshot, now()::text as jetzt`;
    const tabellen = await tx`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`;
    const zaehlung: Record<string, number> = {};
    for (const t of tabellen) {
      const [r] = await tx`select count(*)::int as n from ${tx(t.table_name as string)}`;
      zaehlung[t.table_name as string] = r!.n as number;
    }
    const [m] = await tx`select count(*)::int as n from drizzle.__drizzle_migrations`;
    // pg_dump laeuft, solange die Transaktion offen ist — nur so gilt der Snapshot.
    await pgDump(s!.snapshot as string);
    const p: Zaehlprotokoll = {
      erstellt: new Date().toISOString(),
      dump: dump!,
      snapshot: s!.snapshot as string,
      migrationen: m!.n as number,
      tabellen: zaehlung,
    };
    return p;
  });
  writeFileSync(protokollName(dump!), JSON.stringify(protokoll, null, 2) + "\n");
  console.log(`ZAEHLPROTOKOLL ${protokollName(dump!)} snapshot=${protokoll.snapshot} migrationen=${protokoll.migrationen} tabellen=${Object.keys(protokoll.tabellen).length}`);
  for (const [t, n] of Object.entries(protokoll.tabellen)) console.log(`  ${t} ${n}`);
  await sql.end();
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
