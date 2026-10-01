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
      const [spaeter] = (await tx.execute<{ t: string }>(sql`select (${heute}::date + 4)::text as t`)) as unknown as { t: string }[];
      const lauf3 = await stelleVerifikationsHinweiseZu(tx, spaeter!.t);
      const nach3 = await zaehle();
      pruefe(
        "2 spaeterer Stichtag: Ablauf-Hinweis neu, Vorab-Hinweis erledigt, gleiches Bezugsdatum",
        lauf3.abgelaufen === 1 && lauf3.laeuftAb === 0 && lauf3.vorabErledigt === 1 &&
          nach3.some((z) => z.typ === "verifikation_abgelaufen" && z.zustand === "offen") &&
          nach3.some((z) => z.typ === "verifikation_laeuft_ab" && z.zustand === "erledigt") &&
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
        pruefe("3 Fallback: deaktivierter Pruefer → alle uebrigen aktiven Pruefer/Admins", lauf5.abgelaufen === erwartet.length && JSON.stringify(ist) === JSON.stringify(erwartet), { lauf5, erwartet: erwartet.length, ist: ist.length });
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
