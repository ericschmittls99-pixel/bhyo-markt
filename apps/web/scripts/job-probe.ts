/**
 * AP2.4 PR b (E63): Probe des Verifikations-Jobs gegen die echte Preview-DB,
 * im Deploy-CI je PR. Alles in EINER zurueckgerollten Transaktion — nichts
 * bleibt liegen. Zusicherungen:
 *
 *  1. Idempotenz: der zweite Lauf desselben Stichtags erzeugt nichts.
 *  2. Nachholen: ein spaeterer Stichtag (ausgefallene Tage) stellt genau das
 *     zu, was sich am Zustand geaendert hat — der Vorab-Hinweis wird mit dem
 *     Ablauf gegenstandslos (erledigt), der Ablauf-Hinweis kommt neu.
 *  3. Empfaenger: der Pruefer des letzten geprueft-Ereignisses; ist er
 *     deaktiviert, alle aktiven Pruefer/Admins (Fallback).
 *  4. D3: als abgelaufen markiert → kein Hinweis; ohne Beleg → kein Hinweis.
 *  5. AP2.5 (E66): verwaister Akteur (kein Strom) aelter als
 *     akteur.verwaist_hinweis_monate → akteur_verwaist an alle aktiven
 *     Admins, zweiter Lauf nichts; bekommt er einen Strom, ist der Hinweis
 *     erledigt. Ein junger verwaister Akteur bekommt nichts.
 *  6. AP2.5 PR b (E57): Kontaktperson ohne Aktivitaet seit 25 Monaten →
 *     kontaktperson_loeschpruefung an alle Admins, zweiter Lauf nichts; eine
 *     Aenderung am Beleg ihres Akteurs (Protokoll) erledigt den Hinweis;
 *     eine junge Person bekommt nichts.
 *
 * Laeuft mit tsx (Pfadalias @/ wird nicht gebraucht: relative Importe).
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import { stelleVerifikationsHinweiseZu } from "../lib/inbox/hinweise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";

async function main() {
  // AP2.8 Messung (Eric 08.10.2026): Bestand der Preview als Bezug fuer die synthetische Menge der Wird-frei-Probe.
  {
    const [m] = (await db.execute(sql`select (select count(*)::int from biomassestrom) as stroeme, (select count(*)::int from vergabe_zeitraum) as vergaben`)) as unknown as { stroeme: number; vergaben: number }[];
    console.log(`BESTAND ${JSON.stringify(m)}`);
  }
  const ziel = new URL(url!);
  console.log(`JOBPROBE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };

  try {
    await db.transaction(async (tx) => {
      const [heuteZ] = await tx.execute<{ heute: string }>(sql`select (now() at time zone 'Europe/Berlin')::date::text as heute`);
      const heute = heuteZ!.heute;
      const pruefer = (await tx.execute<{ id: string }>(
        sql`select id from benutzer where aktiv and rolle in ('pruefer', 'admin') order by email`,
      )) as unknown as { id: string }[];
      const [strom] = (await tx.execute<{ id: string }>(sql`select id from biomassestrom order by created_at limit 1`)) as unknown as { id: string }[];
      if (!pruefer.length || !strom) {
        console.log(`PROBEN uebersprungen: pruefer=${pruefer.length} strom=${!!strom}`);
        throw new Error(ROLLBACK);
      }
      const p1 = pruefer[0]!.id;
      // Alle vorhandenen Hinweise und Pruef-Ereignisse zu diesem Strom beiseite (zurueckgerollt).
      // Vorlauf (04.10.2026): Den Bestand der Preview einmal zustellen, damit die Zaehler
      // der Proben nur den Probe-Strom zeigen — sonst ist die Probe rot, sobald die
      // Preview offene Hinweise hat (z. B. nach einem Seed, der Stroeme neu aufbaut).
      // Alles in derselben zurueckgerollten Transaktion.
      const vorlauf = await stelleVerifikationsHinweiseZu(tx, heute);
      console.log("VORLAUF " + JSON.stringify(vorlauf));
      await tx.execute(sql`delete from inbox_eintrag where biomassestrom_id = ${strom.id} and typ::text in ('verifikation_laeuft_ab', 'verifikation_abgelaufen')`);
      await tx.execute(sql`delete from aenderung where entitaet_id = ${strom.id} and art::text in ('geprueft', 'reverifiziert')`);
      const zaehle = async () =>
        ((await tx.execute(
          sql`select typ::text as typ, zustand::text as zustand, empfaenger_id, bezugsdatum::text as bezugsdatum
                       from inbox_eintrag where biomassestrom_id = ${strom.id} and typ::text like 'verifikation_%' order by typ, zustand, empfaenger_id`,
        )) as unknown as { typ: string; zustand: string; empfaenger_id: string; bezugsdatum: string | null }[]);

      // Vertrag, gueltig_bis = heute + 3, Pruefer p1 hat heute geprueft → laeuft_bald_ab (Vorlauf 7).
      const [beleg] = (await tx.execute<{ id: string }>(sql`
        insert into beleg (typ, metadata, gueltig_bis, datei_key, link_url, erstellt_am)
        values ('vertrag', '{"quellenangabe": "Job-Probe"}'::jsonb, (${heute}::date + 3), 'belege/preview/job-probe.pdf', null, now())
        returning id`)) as unknown as { id: string }[];
      await tx.execute(sql`update biomassestrom set status = 'geprueft', beleg_id = ${beleg!.id} where id = ${strom.id}`);
      await tx.execute(sql`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id) values ('biomassestrom', ${strom.id}, 'Job-Probe', 'geprueft', ${p1})`);

      const lauf1 = await stelleVerifikationsHinweiseZu(tx, heute);
      const nach1 = await zaehle();
      pruefe("1a erster Lauf: ein Vorab-Hinweis an den Pruefer", lauf1.laeuftAb === 1 && nach1.length === 1 && nach1[0]!.empfaenger_id === p1 && nach1[0]!.typ === "verifikation_laeuft_ab", { lauf1, nach1 });
      const lauf2 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("1b zweiter Lauf desselben Tages erzeugt nichts", lauf2.laeuftAb === 0 && lauf2.abgelaufen === 0 && (await zaehle()).length === 1, lauf2);

      // 2. Nachholen: Stichtag heute + 4 (gueltig_bis ueberschritten) → Ablauf-Hinweis, Vorab erledigt.
      // Der Vorlauf oben gilt nur fuer `heute`: Bestands-Stroeme, deren Frist zwischen heute
      // und heute + 4 endet, laufen hier ebenfalls ab und zaehlen in lauf3 mit (Rot 07.10.2026,
      // 00:15 Berlin: 9 statt 1, sobald der Kalendertag wechselte). Deshalb werden die Zaehler
      // nur als Untergrenze geprueft; was genau geschah, belegt der Probe-Strom selbst (nach3).
      const [spaeter] = (await tx.execute<{ t: string }>(sql`select (${heute}::date + 4)::text as t`)) as unknown as { t: string }[];
      const lauf3 = await stelleVerifikationsHinweiseZu(tx, spaeter!.t);
      const nach3 = await zaehle();
      pruefe(
        "2 spaeterer Stichtag: Ablauf-Hinweis neu, Vorab-Hinweis erledigt, gleiches Bezugsdatum",
        lauf3.abgelaufen >= 1 && lauf3.laeuftAb === 0 && lauf3.vorabErledigt >= 1 &&
          nach3.length === 2 &&
          nach3.some((z) => z.typ === "verifikation_abgelaufen" && z.zustand === "offen" && z.empfaenger_id === p1) &&
          nach3.some((z) => z.typ === "verifikation_laeuft_ab" && z.zustand === "erledigt" && z.empfaenger_id === p1) &&
          new Set(nach3.map((z) => z.bezugsdatum)).size === 1,
        { lauf3, nach3 },
      );
      const lauf4 = await stelleVerifikationsHinweiseZu(tx, spaeter!.t);
      pruefe("2b erneut am spaeteren Stichtag: nichts", lauf4.abgelaufen === 0 && lauf4.laeuftAb === 0 && lauf4.vorabErledigt === 0, lauf4);

      // 3. Fallback: Pruefer p1 deaktiviert → an alle aktiven Pruefer/Admins (neues Bezugsdatum durch neues gueltig_bis).
      if (pruefer.length >= 2) {
        await tx.execute(sql`update benutzer set aktiv = false where id = ${p1}`);
        await tx.execute(sql`update beleg set gueltig_bis = (${heute}::date - 1) where id = ${beleg!.id}`);
        const lauf5 = await stelleVerifikationsHinweiseZu(tx, heute);
        const nach5 = (await zaehle()).filter((z) => z.zustand === "offen" && z.typ === "verifikation_abgelaufen" && z.bezugsdatum !== null);
        const erwartet = pruefer.slice(1).map((p) => p.id).sort();
        const ist = nach5.filter((z) => z.bezugsdatum !== nach3[0]!.bezugsdatum).map((z) => z.empfaenger_id).sort();
        // Gezaehlt wird am Probe-Strom, nicht global: Das Deaktivieren von p1 kann auf der
        // Preview auch fremde Stroeme betreffen, deren Pruefer p1 ist (Seed-Pruefereignisse).
        pruefe("3 Fallback: deaktivierter Pruefer → alle uebrigen aktiven Pruefer/Admins", lauf5.abgelaufen >= erwartet.length && JSON.stringify(ist) === JSON.stringify(erwartet), { lauf5, erwartet: erwartet.length, ist: ist.length });
        await tx.execute(sql`update benutzer set aktiv = true where id = ${p1}`);
      } else {
        console.log("3 Fallback uebersprungen: nur ein aktiver Pruefer/Admin auf der Preview");
      }

      // 4. D3: markiert → nichts; ohne Beleg → nichts (jeweils neues Bezugsdatum, damit die Idempotenz nicht verdeckt).
      await tx.execute(sql`update beleg set gueltig_bis = (${heute}::date - 2), abgelaufen_am = ${heute}::date where id = ${beleg!.id}`);
      const lauf6 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("4a als abgelaufen markiert: kein Hinweis", lauf6.abgelaufen === 0 && lauf6.laeuftAb === 0, lauf6);
      await tx.execute(sql`update biomassestrom set beleg_id = null where id = ${strom.id}`);
      const lauf7 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("4b ohne Beleg: kein Hinweis", lauf7.abgelaufen === 0 && lauf7.laeuftAb === 0, lauf7);

      // 5. AP2.5 (E66): Verwaist-Hinweis an die Admins — alt → Hinweis, jung → nichts, Strom → erledigt.
      const admins = (await tx.execute<{ id: string }>(sql`select id from benutzer where aktiv and rolle = 'admin'`)) as unknown as { id: string }[];
      const altId = "00000000-0000-4000-8000-00000000a25a";
      const jungId = "00000000-0000-4000-8000-00000000a25b";
      await tx.execute(sql`insert into akteur (id, name, sektor, status, sitz_plz, sitz_ort, created_at) values
        (${altId}, 'Job-Probe verwaist alt', 'ohne_sektor', 'entwurf', '00000', 'Probe', now() - interval '8 months'),
        (${jungId}, 'Job-Probe verwaist jung', 'ohne_sektor', 'entwurf', '00000', 'Probe', now() - interval '1 month')`);
      const lauf8 = await stelleVerifikationsHinweiseZu(tx, heute);
      const verwaistZeilen = (await tx.execute(sql`select empfaenger_id, akteur_id, zustand::text as zustand from inbox_eintrag where akteur_id in (${altId}, ${jungId})`)) as unknown as { empfaenger_id: string; akteur_id: string; zustand: string }[];
      pruefe("5a verwaist 8 Monate: Hinweis an alle aktiven Admins, junger Akteur nichts", lauf8.verwaist === admins.length && verwaistZeilen.every((z) => z.akteur_id === altId) && verwaistZeilen.length === admins.length, { lauf8, admins: admins.length, zeilen: verwaistZeilen.length });
      const lauf9 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("5b zweiter Lauf: kein weiterer Verwaist-Hinweis", lauf9.verwaist === 0 && lauf9.verwaistErledigt === 0, lauf9);
      await tx.execute(sql`update biomassestrom set akteur_id = ${altId} where id = ${strom.id}`);
      const lauf10 = await stelleVerifikationsHinweiseZu(tx, heute);
      const nach10 = (await tx.execute(sql`select count(*)::int as offen from inbox_eintrag where akteur_id = ${altId} and zustand = 'offen'`)) as unknown as { offen: number }[];
      pruefe("5c Akteur hat wieder einen Strom: Verwaist-Hinweise erledigt", lauf10.verwaistErledigt === admins.length && Number(nach10[0]!.offen) === 0, { lauf10, offen: nach10[0]!.offen });

      // 6. AP2.5 PR b (E57): Loeschpruefung — alt → Hinweis, jung → nichts, Aktivitaet → erledigt.
      const altP = "00000000-0000-4000-8000-00000000b25a";
      const jungP = "00000000-0000-4000-8000-00000000b25b";
      await tx.execute(sql`insert into kontaktperson (id, akteur_id, name, created_at, updated_at) values
        (${altP}, ${altId}, 'Job-Probe Person alt', now() - interval '25 months', now() - interval '25 months'),
        (${jungP}, ${altId}, 'Job-Probe Person jung', now(), now())`);
      // Der Akteur altId hat seit Schritt 5 einen Strom; dessen Protokoll darf nicht juenger als 25 Monate wirken:
      await tx.execute(sql`delete from aenderung where entitaet_id = ${strom.id}`);
      const lauf11 = await stelleVerifikationsHinweiseZu(tx, heute);
      const zeilen11 = (await tx.execute(sql`select kontaktperson_id, zustand::text as zustand from inbox_eintrag where kontaktperson_id in (${altP}, ${jungP})`)) as unknown as { kontaktperson_id: string; zustand: string }[];
      pruefe("6a Person 25 Monate ohne Aktivitaet: Loeschpruefung an alle Admins, junge Person nichts", lauf11.loeschpruefung === admins.length && zeilen11.length === admins.length && zeilen11.every((z) => z.kontaktperson_id === altP), { lauf11, zeilen: zeilen11.length });
      const lauf12 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("6b zweiter Lauf: nichts", lauf12.loeschpruefung === 0 && lauf12.loeschpruefungErledigt === 0, lauf12);
      await tx.execute(sql`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id) values ('biomassestrom', ${strom.id}, 'Job-Probe Aktivitaet', 'geaendert', ${p1})`);
      const lauf13 = await stelleVerifikationsHinweiseZu(tx, heute);
      const offen13 = (await tx.execute(sql`select count(*)::int as n from inbox_eintrag where kontaktperson_id = ${altP} and zustand = 'offen'`)) as unknown as { n: number }[];
      pruefe("6c Aktivitaet am Beleg des Akteurs: Loeschpruefung erledigt", lauf13.loeschpruefungErledigt === admins.length && Number(offen13[0]!.n) === 0, { lauf13, offen: offen13[0]!.n });

      // 7. Betrieb 05.10.2026: zustandsbasiertes Abraeumen der Ablauf-Hinweise —
      //    je ein Fall fachliche Aenderung (in Pruefung), Frist verschoben,
      //    Strom verworfen; dazu ein Fall, in dem die Bedingung weiter gilt.
      //    Frischer Ausgangszustand am Probe-Strom: Vertrag bis heute+3, geprueft.
      await tx.execute(sql`update benutzer set aktiv = true where id = ${p1}`);
      await tx.execute(sql`delete from inbox_eintrag where biomassestrom_id = ${strom.id} and typ::text in ('verifikation_laeuft_ab', 'verifikation_abgelaufen')`);
      const [beleg7] = (await tx.execute<{ id: string }>(sql`
        insert into beleg (typ, metadata, gueltig_bis, datei_key, link_url, erstellt_am)
        values ('vertrag', '{"quellenangabe": "Job-Probe 7"}'::jsonb, (${heute}::date + 3), 'belege/preview/job-probe-7.pdf', null, now())
        returning id`)) as unknown as { id: string }[];
      await tx.execute(sql`update biomassestrom set status = 'geprueft', beleg_id = ${beleg7!.id} where id = ${strom.id}`);
      // Schritt 6 hat das Protokoll des Stroms geleert; ohne Pruef-Ereignis waere der
      // Zustand pruefdatum_unbekannt (Ablauf-Hinweis ohne Bezugsdatum) statt laeuft_bald_ab.
      await tx.execute(sql`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id) values ('biomassestrom', ${strom.id}, 'Job-Probe 7', 'geprueft', ${p1})`);
      const offene = async () => (await zaehle()).filter((z) => z.zustand === "offen");
      const lauf14 = await stelleVerifikationsHinweiseZu(tx, heute);
      const nach14 = await offene();
      pruefe("7a Ausgang: Vorab-Hinweis offen, nichts abgeraeumt", lauf14.laeuftAb >= 1 && lauf14.abgeraeumt === 0 && nach14.length >= 1 && nach14.every((z) => z.typ === "verifikation_laeuft_ab"), { lauf14, nach14 });
      const lauf15 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("7b Bedingung gilt weiter: zweiter Lauf raeumt nichts ab, Hinweis bleibt offen", lauf15.abgeraeumt === 0 && (await offene()).length === nach14.length, { lauf15 });
      // Frist verschoben (heute+5, weiter „laeuft bald ab"): alter Hinweis abgeraeumt, neuer mit neuem Bezugsdatum.
      await tx.execute(sql`update beleg set gueltig_bis = (${heute}::date + 5) where id = ${beleg7!.id}`);
      const lauf16 = await stelleVerifikationsHinweiseZu(tx, heute);
      const nach16 = await offene();
      pruefe("7c Frist verschoben: alter Hinweis abgeraeumt, neuer Hinweis mit neuem Bezugsdatum", lauf16.abgeraeumt === nach14.length && lauf16.laeuftAb === nach14.length && nach16.length === nach14.length && nach16.every((z) => z.bezugsdatum !== nach14[0]!.bezugsdatum), { lauf16, nach16 });
      // Fachliche Aenderung: Strom zurueck in Pruefung → Bedingung weg, nichts Neues.
      await tx.execute(sql`update biomassestrom set status = 'in_pruefung' where id = ${strom.id}`);
      const lauf17 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("7d fachliche Aenderung (in Pruefung): Hinweis abgeraeumt, kein neuer", lauf17.abgeraeumt === nach16.length && lauf17.laeuftAb === 0 && (await offene()).length === 0, { lauf17 });
      // Wieder geprueft mit neuer Frist (heute+6) → neuer Hinweis; dann verworfen → abgeraeumt.
      await tx.execute(sql`update biomassestrom set status = 'geprueft' where id = ${strom.id}`);
      await tx.execute(sql`update beleg set gueltig_bis = (${heute}::date + 6) where id = ${beleg7!.id}`);
      const lauf18 = await stelleVerifikationsHinweiseZu(tx, heute);
      const nach18 = await offene();
      await tx.execute(sql`update biomassestrom set status = 'verworfen' where id = ${strom.id}`);
      const lauf19 = await stelleVerifikationsHinweiseZu(tx, heute);
      pruefe("7e Strom verworfen: Hinweis abgeraeumt", lauf18.laeuftAb === nach18.length && nach18.length >= 1 && lauf19.abgeraeumt === nach18.length && lauf19.laeuftAb === 0 && (await offene()).length === 0, { lauf18, lauf19 });

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) {
      console.error("::error::JOB-PROBE abgebrochen: " + (e instanceof Error ? e.message : String(e)));
      await verbindung.end();
      process.exit(1);
    }
  }
  await verbindung.end();
  if (fehler.length) {
    console.error("::error::JOB-PROBE VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("JOBPROBE OK");
}

main().catch(async (e) => {
  console.error(e);
  await verbindung.end();
  process.exit(2);
});
