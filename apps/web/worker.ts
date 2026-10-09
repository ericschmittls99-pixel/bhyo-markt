/**
 * AP2.4 PR b (E63): Eigener Worker-Einstieg um den OpenNext-Handler herum —
 * einzig fuer den Cron (scheduled). fetch bleibt der generierte Handler.
 * Muster: https://opennext.js.org/cloudflare/howtos/custom-worker
 *
 * Der Cron feuert um 03:00 und 04:00 UTC (wrangler.jsonc); weiter geht es
 * nur um 05:00 Berlin (lib/jobs/zeit.ts). Der Job bekommt Datenbank und
 * Zeitpunkt hereingereicht und protokolliert sich selbst in job_lauf.
 */
// @ts-ignore `.open-next/worker.js` entsteht beim Build (opennextjs-cloudflare build).
import { default as handler } from "./.open-next/worker.js";
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";

import type { BelegeBucket } from "./lib/db";

import { loescheAlteImportUploads, loescheAlteImportZeilen, verwirfInaktiveLaeufe } from "./lib/jobs/import-aufraeumen";
import { fuehreVerifikationsJobAus } from "./lib/jobs/verifikation";
import { raeumeInboxAuf } from "./lib/inbox/aufbewahrung";
import { jobLauf } from "@bhyo/db/schema";
import { and, eq, sql as dsql } from "drizzle-orm";
import { JOB_VERIFIKATION } from "./lib/jobs/verifikation";
import { JOB_STUNDE_BERLIN, istBerlinStunde } from "./lib/jobs/zeit";
import { kalendertag } from "./lib/datum";

interface Umgebung {
  HYPERDRIVE?: { connectionString: string };
  ENVIRONMENT?: string;
  /** AP2.7 PR b: Roh-Uploads des Imports (import/…) aelter als 24 h loeschen (E67). */
  BELEGE?: BelegeBucket;
}
interface CronEreignis {
  scheduledTime: number;
  cron: string;
}
interface Kontext {
  waitUntil(p: Promise<unknown>): void;
}

async function lauf(env: Umgebung, jetzt: Date): Promise<void> {
  const cs = env.HYPERDRIVE?.connectionString;
  if (!cs) {
    console.error("JOB verifikation: HYPERDRIVE-Bindung fehlt");
    return;
  }
  // Kurzlebige Verbindung wie withDb (lib/db.ts), hier ohne Request-Kontext.
  const sql = createSql(cs);
  const db = drizzle(sql, { schema });
  try {
    const ergebnis = await fuehreVerifikationsJobAus(db, jetzt);
    console.log(`JOB verifikation ${env.ENVIRONMENT ?? "?"} ${JSON.stringify(ergebnis)}`);
    // AP2.7 PR c (E67): Zeilen abgeschlossener Import-Laeufe nach der Aufbewahrungsfrist.
    const zeilen = await loescheAlteImportZeilen(db, kalendertag(jetzt));
    console.log(`JOB import-zeilen ${env.ENVIRONMENT ?? "?"} ${JSON.stringify(zeilen)}`);
    // AP2.7 PR g: liegengebliebene (nie ausgefuehrte) Laeufe nach import.lauf_inaktiv_tage verwerfen.
    const verworfen = await verwirfInaktiveLaeufe(db, kalendertag(jetzt), env.BELEGE ? { bucket: env.BELEGE, env: env.ENVIRONMENT ?? "?" } : undefined);
    console.log(`JOB import-verwerfen ${env.ENVIRONMENT ?? "?"} ${JSON.stringify(verworfen)}`);
    // AP2.6 PR d (E71, D14): Inbox-Eintraege nach der Aufbewahrung loeschen — nach dem
    // Verifikations-Job, damit frisch abgeraeumte Hinweise erst ab heute zaehlen.
    const aufbewahrung = await raeumeInboxAuf(db, kalendertag(jetzt));
    console.log(`JOB inbox-aufbewahrung ${env.ENVIRONMENT ?? "?"} ${JSON.stringify(aufbewahrung)}`);
    // Eric 08.10.2026 (j): die Zahl geloeschter Eintraege je Lauf steht in job_lauf.schritte
    // (Leseweg-Zeile JOB_LAUF letzte_schritte) — am Lauf des heutigen Stichtags.
    await db
      .update(jobLauf)
      .set({ schritte: dsql`coalesce(${jobLauf.schritte}, '{}'::jsonb) || ${JSON.stringify({ inbox_aufbewahrung_erledigt: aufbewahrung.erledigt, inbox_aufbewahrung_gelesen: aufbewahrung.gelesen })}::jsonb` })
      .where(and(eq(jobLauf.job, JOB_VERIFIKATION), eq(jobLauf.stichtag, kalendertag(jetzt))));
  } finally {
    await sql.end().catch(() => {});
  }
  // Unabhaengig von der Datenbank: liegengebliebene Roh-Uploads des Imports.
  if (env.BELEGE) {
    const aufgeraeumt = await loescheAlteImportUploads(env.BELEGE, jetzt);
    console.log(`JOB import-aufraeumen ${env.ENVIRONMENT ?? "?"} ${JSON.stringify(aufgeraeumt)}`);
  } else {
    console.error("JOB import-aufraeumen: BELEGE-Bindung fehlt");
  }
}

export default {
  fetch: handler.fetch,
  async scheduled(ereignis: CronEreignis, env: Umgebung, ctx: Kontext) {
    const jetzt = new Date(ereignis.scheduledTime);
    if (!istBerlinStunde(jetzt, JOB_STUNDE_BERLIN)) {
      console.log(`JOB verifikation: ${jetzt.toISOString()} ist nicht ${JOB_STUNDE_BERLIN}:00 Berlin — nichts zu tun`);
      return;
    }
    ctx.waitUntil(lauf(env, jetzt));
  },
};
