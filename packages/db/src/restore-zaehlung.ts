/**
 * Restore-Nachweis (E37-Nachtrag, 28.09.2026): vergleicht das Restore-Ziel
 * gegen das ZAEHLPROTOKOLL des Dumps (gleicher Snapshot, siehe
 * backup-zaehlung.ts) — nicht gegen die laufende Production, die sich seit
 * dem Backup legitim veraendert haben darf. Jede Abweichung ist rot; fehlt
 * das Protokoll, ist der Lauf rot mit "kein Zaehlprotokoll", nicht gruen.
 * Dazu PostGIS-Extension im Restore. Nur lesend.
 *
 * Umgebung: ZIEL_DATABASE_URL (Restore-Ziel, der Wegwerf-Branch des Laufs),
 * ZAEHLPROTOKOLL (Pfad zur JSON-Datei). Kein Secret — die URL entsteht im Lauf.
 */
import { existsSync, readFileSync } from "node:fs";

import postgres from "postgres";

import { type Zaehlprotokoll, vergleicheMitProtokoll } from "./zaehlprotokoll";

const restoreUrl = process.env.ZIEL_DATABASE_URL;
const protokollPfad = process.env.ZAEHLPROTOKOLL;
if (!restoreUrl) {
  console.error("ZIEL_DATABASE_URL ist Pflicht.");
  process.exit(2);
}
const restoreHost = new URL(restoreUrl).hostname;
if (restoreHost.startsWith("ep-purple-glade") || restoreHost.startsWith("ep-rough-term")) {
  console.error(`::error::ZIEL_DATABASE_URL zeigt auf ${restoreHost} — das ist Production oder Preview, kein Restore-Ziel. Abbruch.`);
  process.exit(1);
}
if (!protokollPfad || !existsSync(protokollPfad)) {
  console.error(`::error::RESTORE-NACHWEIS VERLETZT: kein Zaehlprotokoll (${protokollPfad ?? "ZAEHLPROTOKOLL nicht gesetzt"}). Ohne Protokoll gibt es keinen Nachweis — der Lauf ist rot, nicht gruen.`);
  process.exit(1);
}
const protokoll = JSON.parse(readFileSync(protokollPfad, "utf8")) as Zaehlprotokoll;

const restore = postgres(restoreUrl, { max: 1, fetch_types: false });

async function main() {
  console.log(`RESTORE host=${restoreHost}`);
  console.log(`PROTOKOLL ${protokollPfad} dump=${protokoll.dump} snapshot=${protokoll.snapshot} erstellt=${protokoll.erstellt}`);

  const tabellen = (
    await restore`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`
  ).map((r) => r.table_name as string);
  const zaehlung: Record<string, number> = {};
  for (const t of tabellen) {
    const [r] = await restore`select count(*)::int as n from ${restore(t)}`;
    zaehlung[t] = r!.n as number;
  }
  const [m] = await restore`select count(*)::int as n from drizzle.__drizzle_migrations`;
  const [p] = await restore`select extversion from pg_extension where extname = 'postgis'`;

  const v = vergleicheMitProtokoll(protokoll, { migrationen: m!.n as number, tabellen: zaehlung });
  console.log("ZAEHLUNG tabelle | protokoll | restore");
  for (const z of v.zeilen) console.log(`  ${z.tabelle} | ${z.protokoll} | ${z.restore ?? "fehlt"} | ${z.restore === z.protokoll ? "gleich" : "ABWEICHUNG"}`);
  const zusaetzlich = tabellen.filter((t) => !(t in protokoll.tabellen));
  if (zusaetzlich.length) console.log(`HINWEIS Tabellen im Restore ohne Protokolleintrag: ${zusaetzlich.join(", ")}`);
  console.log(`MIGRATIONEN protokoll=${protokoll.migrationen} restore=${m!.n} | POSTGIS ${p?.extversion ?? "fehlt"}`);
  if (!p) v.fehler.push("PostGIS fehlt im Restore");

  await restore.end();
  if (v.fehler.length) {
    console.error("::error::RESTORE-NACHWEIS VERLETZT: " + v.fehler.join(" · "));
    process.exit(1);
  }
  console.log(`Restore-Nachweis OK: ${v.zeilen.length} Tabellen wie im Zaehlprotokoll, Migrationsstand ${protokoll.migrationen}, PostGIS ${p!.extversion}.`);
}

void main().catch(async (e) => {
  console.error(e);
  await restore.end();
  process.exit(2);
});
