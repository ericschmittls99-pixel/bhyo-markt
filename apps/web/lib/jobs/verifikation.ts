/**
 * AP2.4 PR b (E63): Der taegliche Verifikations-Job. Ein Lauf je Stichtag
 * (Kalendertag Berlin): job_lauf mit UNIQUE(job, stichtag) macht den Start
 * idempotent — kommt der zweite Cron-Aufruf desselben Tages durch (oder ein
 * Retry), findet er den Lauf vor und tut nichts. Ergebnis, Anzahl und
 * Fehlertext stehen im Lauf; die Job-Wache (GitHub, 06:00 Berlin, nur lesend)
 * prueft, dass fuer heute ein Lauf mit ergebnis = ok existiert.
 *
 * Kein Zugriff auf Next, Header oder Cloudflare-Kontext: Der Aufrufer
 * (worker.ts) reicht die Datenbank und den Zeitpunkt herein.
 */
import { jobLauf } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { kalendertag } from "../datum";
import type { AppDb } from "../db";
import { stelleVerifikationsHinweiseZu, type HinweisErgebnis } from "../inbox/hinweise";

export const JOB_VERIFIKATION = "verifikation";

export type JobErgebnis =
  | { lauf: "uebersprungen"; stichtag: string }
  | { lauf: "ok"; stichtag: string; hinweise: HinweisErgebnis }
  | { lauf: "fehler"; stichtag: string; fehler: string };

export async function fuehreVerifikationsJobAus(db: AppDb, jetzt: Date): Promise<JobErgebnis> {
  const stichtag = kalendertag(jetzt);
  // Betrieb 06.10.2026 (Eric): Laufzeit messen. `jetzt` ist der Cron-Zeitpunkt;
  // gestartet_am setzt die DB beim ersten Schreiben (Default now()) — die
  // Differenz ist der Verbindungsaufbau. Dazu die Dauer des ersten Statements
  // aus Sicht des Workers (schritte.verbindung) und je Schritt die Millisekunden.
  const t0 = Date.now();
  const gestartet = await db
    .insert(jobLauf)
    .values({ job: JOB_VERIFIKATION, stichtag, ausgeloestAm: jetzt })
    .onConflictDoNothing({ target: [jobLauf.job, jobLauf.stichtag] })
    .returning({ id: jobLauf.id });
  const verbindung = Date.now() - t0;
  const lauf = gestartet[0];
  if (!lauf) return { lauf: "uebersprungen", stichtag };

  try {
    const hinweise = await db.transaction((tx) => stelleVerifikationsHinweiseZu(tx, stichtag));
    const schritte = { verbindung, ...hinweise.schritteMs, gesamt: Date.now() - t0 };
    await db
      .update(jobLauf)
      .set({
        ergebnis: "ok",
        anzahl: hinweise.laeuftAb + hinweise.abgelaufen + hinweise.verwaist + hinweise.loeschpruefung,
        abgeraeumt: hinweise.abgeraeumt,
        schritte,
        beendetAm: new Date(),
      })
      .where(eq(jobLauf.id, lauf.id));
    return { lauf: "ok", stichtag, hinweise };
  } catch (e) {
    const fehler = e instanceof Error ? e.message : String(e);
    await db
      .update(jobLauf)
      .set({ ergebnis: "fehler", fehler: fehler.slice(0, 2000), beendetAm: new Date() })
      .where(eq(jobLauf.id, lauf.id))
      .catch(() => {});
    return { lauf: "fehler", stichtag, fehler };
  }
}
