/**
 * AP2.9 (E76): Probelauf des Roundups gegen die Datenbank (Preview im
 * Deploy-CI je PR, Wegwerf-DB im Testlauf) — in EINER zurueckgerollten
 * Transaktion, nichts bleibt liegen, nichts wird gesendet (Modus protokoll).
 *
 * Unabhaengig vom Preview-Zustand (Eric 12.10.2026, docs/betrieb.md): eigene
 * Probe-Nutzer und -Eintraege nur in der Transaktion, feste Stichtage 2099,
 * Zaehlungen als Zuwachs gegenueber der Grundlinie vor dem Lauf. Echte Nutzer
 * der Preview laufen mit, werden aber nie zurueckgesetzt.
 * Zusicherungen:
 *
 *  1. Der Lauf legt genau eine job_lauf-Zeile `roundup` fuer den Stichtag an
 *     und meldet je aktivem Nutzer mit Roundup an eine Zeile
 *     `ROUNDUP nutzer=<id> wuerde_senden=ja|nein neu=… offen=… typen={…}`;
 *     Probe-Nutzer A (ein offener Eintrag, nie ein Roundup) „ja", B „nein",
 *     C (abgemeldet) ohne Zeile — beide Pfade werden durchlaufen.
 *  2. Im Log steht keine Adresse, kein Betreff, kein Text — nur Nutzer-IDs
 *     und Zaehler (E73, Eric 09.10.2026).
 *  3. „Wuerde senden" genau fuer die Nutzer mit mindestens einem neuen
 *     offenen Eintrag; fuer sie entsteht ein Ereignis mail_gesendet
 *     (Probemodus) und roundup_zuletzt_am wird gesetzt — als Zuwachs
 *     gezaehlt, dazu A genau ein Ereignis und markiert, B keins.
 *  4. Der zweite Lauf desselben Stichtags ist uebersprungen (Idempotenz).
 *  5. Am Wochenende (Berliner Kalendertag, Samstag 2099-01-03) laeuft nichts
 *     und entsteht keine Zeile.
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
import { fuehreRoundupAus, roundupZugriff } from "../lib/jobs/roundup";
import { raeumeStoerungenAb, stelleSecretAblaufZu, stelleStoerungZu } from "../lib/inbox/mail-hinweise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";
const KONFIG = { umgebung: "preview", modus: "protokoll" as const, absender: "news@bhyo.de", graph: null, secretAblauf: null };

/**
 * Feste Stichtage weit in der Zukunft (Eric 12.10.2026): die Preview erbt die
 * Cron-Trigger (wrangler.jsonc) und schreibt werktags um 07:07 Berlin einen
 * echten Lauf fuer den Tages-Stichtag — mit dem Tagesdatum war Fall 1 danach
 * „uebersprungen" (Lauf 38248575725). Einen Montag 2099 erreicht kein echter
 * Lauf; der Samstag davor deckt den Wochenend-Fall. 06:07 UTC = 07:07 Berlin (CET).
 */
const JETZT = new Date("2099-01-05T06:07:00Z");
const SAMSTAG = new Date("2099-01-03T06:07:00Z");
const STICHTAG = "2099-01-05";
/** Probe-Nutzer, nur in der zurueckgerollten Transaktion: A mit Neuem, B ohne, C abgemeldet. */
const NUTZER_A = "00000000-0000-4000-8000-00000000f0a1";
const NUTZER_B = "00000000-0000-4000-8000-00000000f0b2";
const NUTZER_C = "00000000-0000-4000-8000-00000000f0c3";

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
      const zaehl = async (q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as { n: number }[])[0]!.n);
      const jetzt = JETZT;
      const stichtag = STICHTAG;

      // Eigene Fixture-Daten statt Preview-Zustand (docs/betrieb.md, Leitregel 12.10.2026):
      // A hat einen offenen Eintrag und noch nie ein Roundup (alles Offene zaehlt als neu),
      // B hat nichts, C ist abgemeldet. Echte Nutzer bleiben unangetastet; sie laufen mit,
      // alle Zaehlungen sind Zuwachs gegenueber der Grundlinie bzw. auf A/B/C gefiltert.
      await tx.execute(sql`insert into benutzer (id, email, name, rolle, aktiv, roundup, roundup_zuletzt_am) values
        (${NUTZER_A}, 'probe-roundup-a@probe.invalid', 'Probe Roundup A', 'betrachter', true, true, null),
        (${NUTZER_B}, 'probe-roundup-b@probe.invalid', 'Probe Roundup B', 'betrachter', true, true, null),
        (${NUTZER_C}, 'probe-roundup-c@probe.invalid', 'Probe Roundup C', 'betrachter', true, false, null)`);
      // Ein offener Eintrag ohne Objekt und ohne Urheber (Typ mail_stoerung, CHECKs) fuer A.
      await tx.execute(sql`insert into inbox_eintrag (empfaenger_id, typ, ursache, anzahl, zustand) values (${NUTZER_A}, 'mail_stoerung'::inbox_typ, 'nicht_konfiguriert', 1, 'offen')`);
      const ereignisseSql = sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet'`;
      const modusSql = sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet' and text like '%Tages-Mail protokolliert (Probemodus, nicht gesendet), modus=protokoll: %'`;
      const grundlinie = { ereignisse: await zaehl(ereignisseSql), modus: await zaehl(modusSql), laeufe: await zaehl(sql`select count(*)::int as n from job_lauf where job = 'roundup' and stichtag >= '2099-01-01'`) };
      pruefe("0 Grundlinie: kein Lauf 2099 vorhanden", grundlinie.laeufe === 0, grundlinie);

      // 5: Wochenende — Samstag vor dem Stichtag.
      const we = await fuehreRoundupAus(zugriff, SAMSTAG, KONFIG, "https://probe.invalid", undefined, log);
      const [weZeile] = (await tx.execute(sql`select 1 from job_lauf where job = 'roundup' and stichtag = '2099-01-03'`)) as unknown as unknown[];
      pruefe("5 Wochenende: kein Lauf, keine Zeile", we.lauf === "wochenende" && we.stichtag === "2099-01-03" && !weZeile, we);

      // 1–3: erster Lauf am Werktag.
      const erg = await fuehreRoundupAus(zugriff, jetzt, KONFIG, "https://probe.invalid", undefined, log);
      const [zeile] = (await tx.execute(sql`select ergebnis, anzahl, schritte from job_lauf where job = 'roundup' and stichtag = ${stichtag}`)) as unknown as { ergebnis: string; anzahl: number; schritte: Record<string, number | string> }[];
      pruefe("1 Lauf ok, genau eine job_lauf-Zeile roundup mit schritte", erg.lauf === "ok" && erg.stichtag === stichtag && !!zeile && zeile.ergebnis === "ok", { erg, zeile });
      // 6: Summen in schritte, ohne Log lesbar; im Probemodus gesendet=0; abgemeldet zaehlt C mit.
      const s = zeile?.schritte ?? {};
      const abgemeldet = await zaehl(sql`select count(*)::int as n from benutzer where aktiv and not roundup`);
      pruefe(
        "6 schritte: modus=protokoll, gesendet=0, protokolliert=wuerde_senden, nichts_neu=empfaenger-wuerde_senden, abgemeldet aus der Tabelle (mit C), anzahl=0",
        erg.lauf === "ok" && s.modus === "protokoll" && s.gesendet === 0 && s.protokolliert === erg.wuerdeSenden && s.nichts_neu === erg.empfaenger - erg.wuerdeSenden && s.abgemeldet === abgemeldet && abgemeldet >= 1 && zeile?.anzahl === 0,
        { schritte: s, abgemeldet, anzahl: zeile?.anzahl },
      );
      const nutzerZeilen = logs.filter((l) => l.startsWith("ROUNDUP nutzer="));
      pruefe("1 je Nutzer eine ROUNDUP-Zeile", erg.lauf === "ok" && nutzerZeilen.length === erg.empfaenger, { zeilen: nutzerZeilen.length, empfaenger: erg.lauf === "ok" ? erg.empfaenger : null });
      const zeileA = nutzerZeilen.find((l) => l.startsWith(`ROUNDUP nutzer=${NUTZER_A} `)) ?? null;
      const zeileB = nutzerZeilen.find((l) => l.startsWith(`ROUNDUP nutzer=${NUTZER_B} `)) ?? null;
      const zeileC = nutzerZeilen.find((l) => l.startsWith(`ROUNDUP nutzer=${NUTZER_C} `)) ?? null;
      pruefe(
        "1 Probe-Nutzer: A wuerde senden (neu=1, offen=1), B nichts neu (neu=0, offen=0), C abgemeldet ohne Zeile",
        /wuerde_senden=ja neu=1 offen=1 typen=\{"mail_stoerung":\{"offen":1,"neu":1\}\}$/.test(zeileA ?? "") && /wuerde_senden=nein neu=0 offen=0 /.test(zeileB ?? "") && zeileC === null,
        { a: zeileA, b: zeileB, c: zeileC },
      );
      pruefe("2 Log ohne Adresse, Betreff oder Text (nur Nutzer-IDs und Zaehler)", logs.every((l) => !/@/.test(l) && !/betreff=|text=|bhyo:/.test(l)), logs.length);
      const ja = nutzerZeilen.filter((l) => /wuerde_senden=ja/.test(l)).length;
      const zuwachs = { ereignisse: (await zaehl(ereignisseSql)) - grundlinie.ereignisse, modus: (await zaehl(modusSql)) - grundlinie.modus };
      const markiert = await zaehl(sql`select count(*)::int as n from benutzer where roundup_zuletzt_am = ${jetzt.toISOString()}::timestamptz`);
      pruefe(
        "3 wuerde senden = Zuwachs Ereignisse mail_gesendet = markierte Nutzer; jedes neue Ereignis nennt modus=protokoll und nicht gesendet",
        erg.lauf === "ok" && ja === erg.wuerdeSenden && ja >= 1 && zuwachs.ereignisse === ja && markiert === ja && zuwachs.modus === ja,
        { ja, zuwachs, markiert },
      );
      const ereignisseA = await zaehl(sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet' and entitaet_typ::text = 'benutzer' and entitaet_id = ${NUTZER_A}`);
      const ereignisseB = await zaehl(sql`select count(*)::int as n from aenderung where art::text = 'mail_gesendet' and entitaet_typ::text = 'benutzer' and entitaet_id = ${NUTZER_B}`);
      const [markA] = (await tx.execute(sql`select roundup_zuletzt_am = ${jetzt.toISOString()}::timestamptz as m from benutzer where id = ${NUTZER_A}`)) as unknown as { m: boolean }[];
      const [markB] = (await tx.execute(sql`select roundup_zuletzt_am is null as m from benutzer where id = ${NUTZER_B}`)) as unknown as { m: boolean }[];
      pruefe("3 Probe-Nutzer: A genau ein Ereignis und markiert, B kein Ereignis und unmarkiert", ereignisseA === 1 && markA?.m === true && ereignisseB === 0 && markB?.m === true, { ereignisseA, markA: markA?.m, ereignisseB, markB: markB?.m });

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
