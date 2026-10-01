/**
 * AP2.4 PR b (E63): Job-Wache — nur lesend. Rot, wenn fuer den heutigen
 * Stichtag (Kalendertag Berlin) kein Lauf des Verifikations-Jobs mit
 * ergebnis = ok in job_lauf steht. Laeuft im GitHub-Workflow job-wache.yml
 * taeglich um 06:00 Berlin (Cron 04:00 und 05:00 UTC, weiter nur in der
 * Berliner Stunde 6 — dieselbe Technik wie der Job selbst) gegen Production
 * ueber die Lese-Berechtigung (Environment production-lesend, nur main).
 *
 * Aufruf: tsx src/job-wache.ts [stichtag JJJJ-MM-TT] — ein uebergebener
 * Stichtag ersetzt „heute" (Rot-Nachweis mit einem Tag ohne Lauf).
 * Umgebungsvariable JOB_WACHE_STUNDE: Berliner Stunde, in der die Wache
 * prueft (Standard 6); leer oder „immer" = ohne Stundenpruefung.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}

const STUNDE = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hourCycle: "h23" });
const berlinStunde = (d: Date) => Number(STUNDE.formatToParts(d).find((p) => p.type === "hour")!.value);

async function main() {
  const jetzt = new Date();
  const stundeVorgabe = process.env.JOB_WACHE_STUNDE ?? "6";
  if (stundeVorgabe !== "" && stundeVorgabe !== "immer" && berlinStunde(jetzt) !== Number(stundeVorgabe)) {
    console.log(`JOBWACHE ${jetzt.toISOString()} ist nicht ${stundeVorgabe}:00 Berlin — dieser Aufruf prueft nicht.`);
    return;
  }
  const sql = postgres(url!, { max: 1, fetch_types: false });
  const ziel = new URL(url!);
  console.log(`JOBWACHE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const stichtagArg = process.argv[2];
  const [heute] = await sql`select (now() at time zone 'Europe/Berlin')::date::text as t`;
  const stichtag = stichtagArg ?? (heute!.t as string);
  const laeufe = await sql`select job, stichtag::text as stichtag, ergebnis, anzahl, gestartet_am::text as gestartet_am, beendet_am::text as beendet_am, fehler
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
  console.log(`JOBWACHE OK — Lauf ${stichtag}: ok, ${ok.anzahl} Hinweise, beendet ${ok.beendet_am}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
