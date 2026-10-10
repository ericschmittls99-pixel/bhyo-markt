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
 *  6. Umschalten vorbereiten (Eric 10.10.2026): schritte traegt die Summen
 *     mit Modus (modus=protokoll, gesendet=0, protokolliert=wuerde senden,
 *     nichts_neu, abgemeldet) — „gesendet" zaehlt nur modus=graph.
 *  7. Admin-Hinweis mail_stoerung: je Admin und Ursache ein offener Eintrag
 *     (zweite Meldung 0), Abraeumen erledigt alle; kein Objektbezug (CHECK).
 *  8. Secret-Ablauf: 20 Tage vor dem Datum Stufe 30 an jeden Admin, zweiter
 *     Lauf 0; ein neues Datum raeumt die alten ab und stellt neu zu.
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import type { AppDb } from "../lib/db";
import { fuehreRoundupAus, istWerktagBerlin, roundupZugriff } from "../lib/jobs/roundup";
import { raeumeStoerungenAb, stelleSecretAblaufZu, stelleStoerungZu } from "../lib/inbox/mail-hinweise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";
const KONFIG = { modus: "protokoll" as const, absender: "news@bhyo.de", graph: null, secretAblauf: null };

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
      const [zeile] = (await tx.execute(sql`select ergebnis, anzahl, schritte from job_lauf where job = 'roundup' and stichtag = ${stichtag}`)) as unknown as { ergebnis: string; anzahl: number; schritte: Record<string, number | string> }[];
      pruefe("1 Lauf ok, genau eine job_lauf-Zeile roundup mit schritte", erg.lauf === "ok" && !!zeile && zeile.ergebnis === "ok", { erg, zeile });
      // 6: Summen in schritte, ohne Log lesbar; im Probemodus gesendet=0.
      const s = zeile?.schritte ?? {};
      const [abgemeldet] = (await tx.execute(sql`select count(*)::int as n from benutzer where aktiv and not roundup`)) as unknown as { n: number }[];
      pruefe(
        "6 schritte: modus=protokoll, gesendet=0, protokolliert=wuerde_senden, nichts_neu=empfaenger-wuerde_senden, abgemeldet aus der Tabelle, anzahl=0",
        erg.lauf === "ok" && s.modus === "protokoll" && s.gesendet === 0 && s.protokolliert === erg.wuerdeSenden && s.nichts_neu === erg.empfaenger - erg.wuerdeSenden && s.abgemeldet === abgemeldet!.n && zeile?.anzahl === 0,
        { schritte: s, abgemeldet: abgemeldet!.n, anzahl: zeile?.anzahl },
      );
      const nutzerZeilen = logs.filter((l) => l.startsWith("ROUNDUP nutzer="));
      pruefe("1 je Nutzer eine ROUNDUP-Zeile", erg.lauf === "ok" && nutzerZeilen.length === erg.empfaenger, { zeilen: nutzerZeilen.length, empfaenger: erg.lauf === "ok" ? erg.empfaenger : null });
      pruefe("2 Log ohne Adresse, Betreff oder Text (nur Nutzer-IDs und Zaehler)", logs.every((l) => !/@/.test(l) && !/betreff=|text=|bhyo:/.test(l)), logs.length);
      const ja = nutzerZeilen.filter((l) => /wuerde_senden=ja/.test(l)).length;
      const [ereignisse] = (await tx.execute(sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet'`)) as unknown as { n: number }[];
      const [modus] = (await tx.execute(sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet' and text like '%Tages-Mail protokolliert (Probemodus, nicht gesendet), modus=protokoll: %'`)) as unknown as { n: number }[];
      const [markiert] = (await tx.execute(sql`select count(*)::int as n from benutzer where roundup_zuletzt_am = ${jetzt.toISOString()}::timestamptz`)) as unknown as { n: number }[];
      pruefe("3 wuerde senden = Ereignisse mail_gesendet = markierte Nutzer; jedes Ereignis nennt modus=protokoll und nicht gesendet", erg.lauf === "ok" && ja === erg.wuerdeSenden && ereignisse!.n === ja && markiert!.n === ja && modus!.n === ja, { ja, ereignisse: ereignisse!.n, mitModus: modus!.n, markiert: markiert!.n });

      // 4: Idempotenz.
      const zweiter = await fuehreRoundupAus(zugriff, jetzt, KONFIG, "https://probe.invalid", undefined, log);
      pruefe("4 zweiter Lauf desselben Stichtags uebersprungen", zweiter.lauf === "uebersprungen", zweiter);

      // 7: Stoerungs-Hinweis an die Admins — einmal je offener Stoerung, Abraeumen erledigt alle.
      // Vorzustand neutralisieren (in dieser zurueckgerollten Transaktion): offene Mail-Hinweise
      // auf der Preview (z. B. fuer Screenshots angelegt) wuerden sonst die Zaehler verschieben
      // (Befund Lauf 38053404114: st3=0, weil secret_abgelaufen schon offen war).
      const vorher = { stoerungen: await raeumeStoerungenAb(tx as unknown as AppDb), secret: (await stelleSecretAblaufZu(tx as unknown as AppDb, null, stichtag)).abgeraeumt };
      console.log(`  Vorzustand abgeraeumt (nur in der Probe-Transaktion): ${JSON.stringify(vorher)}`);
      const [admins] = (await tx.execute(sql`select count(*)::int as n from benutzer where aktiv and rolle = 'admin'`)) as unknown as { n: number }[];
      const st1 = await stelleStoerungZu(tx as unknown as AppDb, "zugriff_verweigert");
      const st2 = await stelleStoerungZu(tx as unknown as AppDb, "zugriff_verweigert");
      const st3 = await stelleStoerungZu(tx as unknown as AppDb, "secret_abgelaufen");
      const [offenSt] = (await tx.execute(sql`select count(*)::int as n from inbox_eintrag where typ::text = 'mail_stoerung' and zustand = 'offen' and ausloeser_id is null and ereignis_id is null and biomassestrom_id is null and akteur_id is null`)) as unknown as { n: number }[];
      const weg = await raeumeStoerungenAb(tx as unknown as AppDb);
      pruefe("7 Stoerung: je Admin und Ursache ein offener Eintrag, zweite Meldung 0, Abraeumen erledigt alle", st1 === admins!.n && st2 === 0 && st3 === admins!.n && offenSt!.n === 2 * admins!.n && weg === 2 * admins!.n, { admins: admins!.n, st1, st2, st3, offen: offenSt!.n, abgeraeumt: weg });

      // 8: Secret-Ablauf — 20 Tage vor dem Datum nur Stufe 30; zweiter Lauf 0; neues Datum raeumt ab.
      const in20 = new Date(jetzt);
      in20.setUTCDate(in20.getUTCDate() + 20);
      const datum1 = in20.toISOString().slice(0, 10);
      const in60 = new Date(jetzt);
      in60.setUTCDate(in60.getUTCDate() + 60);
      const datum2 = in60.toISOString().slice(0, 10);
      const s1 = await stelleSecretAblaufZu(tx as unknown as AppDb, datum1, stichtag);
      const s2 = await stelleSecretAblaufZu(tx as unknown as AppDb, datum1, stichtag);
      const [stufen] = (await tx.execute(sql`select count(*)::int as n, count(distinct stufe)::int as stufen, min(stufe)::int as stufe from inbox_eintrag where typ::text = 'mail_secret_laeuft_ab' and zustand = 'offen' and bezugsdatum = ${datum1}::date`)) as unknown as { n: number; stufen: number; stufe: number }[];
      const s3 = await stelleSecretAblaufZu(tx as unknown as AppDb, datum2, stichtag);
      pruefe(
        "8 Secret-Ablauf: 20 Tage vorher Stufe 30 je Admin, zweiter Lauf 0, neues Datum (60 Tage) raeumt ab und stellt nichts zu",
        s1.zugestellt === admins!.n && s1.abgeraeumt === 0 && s2.zugestellt === 0 && stufen!.n === admins!.n && stufen!.stufen === 1 && stufen!.stufe === 30 && s3.abgeraeumt === admins!.n && s3.zugestellt === 0,
        { s1, s2, stufen, s3 },
      );

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
