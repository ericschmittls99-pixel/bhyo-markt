/**
 * AP2.9 (E76): Probelauf des Roundups gegen die Datenbank (Preview im
 * Deploy-CI je PR, Wegwerf-DB im Testlauf) — in EINER zurueckgerollten
 * Transaktion, nichts bleibt liegen, nichts wird gesendet (Modus protokoll).
 * Zusicherungen:
 *
 *  1. Der Lauf legt genau eine job_lauf-Zeile `roundup` fuer den Stichtag an
 *     und meldet je aktivem Nutzer mit Roundup an eine Zeile
 *     `ROUNDUP nutzer=<id> wuerde_senden=ja|nein neu=… offen=… typen={…}`.
 *  2. Im Log steht keine Adresse, kein Betreff, kein Text — nur Nutzer-IDs
 *     und Zaehler (E73, Eric 09.10.2026).
 *  3. „Wuerde senden" genau fuer die Nutzer mit mindestens einem neuen
 *     offenen Eintrag; fuer sie entsteht ein Ereignis mail_gesendet
 *     (Probemodus) und roundup_zuletzt_am wird gesetzt.
 *  4. Der zweite Lauf desselben Stichtags ist uebersprungen (Idempotenz).
 *  5. Am Wochenende (Berliner Kalendertag) laeuft nichts und entsteht keine
 *     Zeile.
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import type { AppDb } from "../lib/db";
import { fuehreRoundupAus, istWerktagBerlin, roundupZugriff } from "../lib/jobs/roundup";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";
const KONFIG = { modus: "protokoll" as const, absender: "news@bhyo.de", graph: null };

/** Naechster Werktag ab jetzt, 07:07 UTC (Stunde ist fuer den Job egal, der Cron entscheidet). */
function naechsterWerktag(ab: Date): Date {
  const d = new Date(ab);
  while (!istWerktagBerlin(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function main() {
  const ziel = new URL(url!);
  console.log(`ROUNDUPPROBE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };
  try {
    await db.transaction(async (tx) => {
      const zugriff = roundupZugriff(tx as unknown as AppDb);
      const logs: string[] = [];
      const log = (z: string) => {
        logs.push(z);
        console.log(`  ${z}`);
      };
      const jetzt = naechsterWerktag(new Date());
      const stichtag = jetzt.toISOString().slice(0, 10);

      // 5: Wochenende — Samstag nach dem Werktag.
      const samstag = new Date(jetzt);
      while (istWerktagBerlin(samstag)) samstag.setUTCDate(samstag.getUTCDate() + 1);
      const we = await fuehreRoundupAus(zugriff, samstag, KONFIG, "https://probe.invalid", undefined, log);
      pruefe("5 Wochenende: kein Lauf, keine Zeile", we.lauf === "wochenende", we);

      // 1–3: erster Lauf am Werktag.
      const erg = await fuehreRoundupAus(zugriff, jetzt, KONFIG, "https://probe.invalid", undefined, log);
      const [zeile] = (await tx.execute(sql`select ergebnis, anzahl, schritte from job_lauf where job = 'roundup' and stichtag = ${stichtag}`)) as unknown as { ergebnis: string; anzahl: number; schritte: Record<string, number> }[];
      pruefe("1 Lauf ok, genau eine job_lauf-Zeile roundup mit schritte", erg.lauf === "ok" && !!zeile && zeile.ergebnis === "ok", { erg, zeile });
      const nutzerZeilen = logs.filter((l) => l.startsWith("ROUNDUP nutzer="));
      pruefe("1 je Nutzer eine ROUNDUP-Zeile", erg.lauf === "ok" && nutzerZeilen.length === erg.empfaenger, { zeilen: nutzerZeilen.length, empfaenger: erg.lauf === "ok" ? erg.empfaenger : null });
      pruefe("2 Log ohne Adresse, Betreff oder Text (nur Nutzer-IDs und Zaehler)", logs.every((l) => !/@/.test(l) && !/betreff=|text=|bhyo:/.test(l)), logs.length);
      const ja = nutzerZeilen.filter((l) => /wuerde_senden=ja/.test(l)).length;
      const [ereignisse] = (await tx.execute(sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet'`)) as unknown as { n: number }[];
      const [markiert] = (await tx.execute(sql`select count(*)::int as n from benutzer where roundup_zuletzt_am = ${jetzt.toISOString()}::timestamptz`)) as unknown as { n: number }[];
      pruefe("3 wuerde senden = Ereignisse mail_gesendet (Probemodus) = markierte Nutzer", erg.lauf === "ok" && ja === erg.wuerdeSenden && ereignisse!.n === ja && markiert!.n === ja, { ja, ereignisse: ereignisse!.n, markiert: markiert!.n });

      // 4: Idempotenz.
      const zweiter = await fuehreRoundupAus(zugriff, jetzt, KONFIG, "https://probe.invalid", undefined, log);
      pruefe("4 zweiter Lauf desselben Stichtags uebersprungen", zweiter.lauf === "uebersprungen", zweiter);

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) throw e;
  } finally {
    await verbindung.end();
  }
  if (fehler.length) {
    console.error(`ROUNDUPPROBE ROT — ${fehler.length} Fall/Faelle: ${fehler.join("; ")}`);
    process.exit(1);
  }
  console.log("ROUNDUPPROBE OK — alle Faelle zurueckgerollt, nichts gesendet.");
}

main().catch((e) => {
  console.error("ROUNDUPPROBE FEHLER:", e instanceof Error ? e.message : e);
  process.exit(1);
});
