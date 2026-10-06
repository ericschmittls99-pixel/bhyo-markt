/**
 * AP2.4 PR b (E63), Betrieb 04.10.2026: Job-Wache — nur lesend. Rot, wenn
 * fuer den faelligen Stichtag kein Lauf des Verifikations-Jobs mit
 * ergebnis = ok in job_lauf steht. Faellig ist ab 05:30 Berlin der heutige
 * Kalendertag, davor der gestrige (job-wache-stichtag.ts). JEDER Aufruf
 * prueft — es gibt keinen Ausgang „prueft nicht" mit Gruen mehr; was nicht
 * geprueft werden kann (keine Verbindung, Abfrage scheitert), ist rot.
 * Laeuft im GitHub-Workflow job-wache.yml mehrfach taeglich (krumme Minuten,
 * Doppellaeufe lesend und harmlos) gegen Production ueber die
 * Lese-Berechtigung (Environment production-lesend, nur main).
 *
 * Aufruf: tsx src/job-wache.ts [stichtag JJJJ-MM-TT] — ein uebergebener
 * Stichtag ersetzt den faelligen (Rot-Nachweis mit einem Tag ohne Lauf).
 */
import postgres from "postgres";

import { faelligerStichtag } from "./job-wache-stichtag";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("::error::JOB-WACHE ROT: DATABASE_URL fehlt — nicht pruefbar.");
  process.exit(2);
}

async function main() {
  const jetzt = new Date();
  const faellig = faelligerStichtag(jetzt);
  const stichtagArg = process.argv[2];
  const stichtag = stichtagArg || faellig.stichtag;
  const sql = postgres(url!, { max: 1, fetch_types: false });
  const ziel = new URL(url!);
  console.log(`JOBWACHE host=${ziel.hostname} db=${ziel.pathname.slice(1)} jetzt=${jetzt.toISOString()} stichtag=${stichtag} (${stichtagArg ? "vorgegeben" : faellig.grund})`);
  // Betrieb 06.10.2026: ausgeloest_am und schritte (ms je Schritt) zeigen, wo die Laufzeit bleibt.
  const laeufe = await sql`select job, stichtag::text as stichtag, ergebnis, anzahl, abgeraeumt, ausgeloest_am::text as ausgeloest_am,
                                  gestartet_am::text as gestartet_am, beendet_am::text as beendet_am, schritte, fehler
                             from job_lauf where job = 'verifikation' order by stichtag desc limit 5`;
  console.log("LETZTE_LAEUFE " + JSON.stringify(laeufe));
  const ok = laeufe.find((l) => l.stichtag === stichtag && l.ergebnis === "ok");
  await sql.end();
  if (!ok) {
    const heutiger = laeufe.find((l) => l.stichtag === stichtag);
    console.error(
      `::error::JOB-WACHE ROT: fuer ${stichtag} ${heutiger ? `steht der Lauf auf „${heutiger.ergebnis}" (${heutiger.fehler ?? "ohne Fehlertext"})` : "gibt es keinen Lauf des Verifikations-Jobs"}.`,
    );
    process.exit(1);
  }
  console.log(`JOBWACHE OK — Lauf ${stichtag}: ok, ${ok.anzahl} Hinweise, gestartet ${ok.gestartet_am}, beendet ${ok.beendet_am}.`);
}

main().catch((e) => {
  // Nicht pruefbar ist rot — nie still gruen.
  console.error(`::error::JOB-WACHE ROT: nicht pruefbar — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
