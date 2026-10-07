/**
 * AP2.6 PR d (E71 Punkt 9, D14): Probe der Inbox-Aufbewahrung gegen eine
 * Datenbank mit allen Migrationen (CI-Job wegwerf-db, nichts bleibt). Eigene
 * Probedaten in EINER zurueckgerollten Transaktion; Stichtag = heutiger
 * Kalendertag Berlin aus der Datenbank (parameter_wert verbietet rueckwirkende
 * Werte, Fall 6 setzt einen Wert AM Stichtag), alle Zeitpunkte relativ dazu:
 *
 *  1. Grenze erledigt (14 Tage, tagesgenau Europe/Berlin): 13 Tage bleibt,
 *     14 Tage weg; verworfen zaehlt wie erledigt (OFFEN im PR).
 *  2. Grenze gelesen (60 Tage): 59 bleibt, 60 weg.
 *  3. Ungelesene Eintraege bleiben — auch nach 400 Tagen.
 *  4. Aktive Hinweise aus AP2.8 (biomasse_wird_frei, offen, gelesen, alt)
 *     bleiben; auch der erledigte Wird-frei-Hinweis bleibt (Idempotenz-Index
 *     ueber alle Zustaende, sonst entstuende er neu).
 *  5. Idempotent: ein zweiter Lauf desselben Stichtags loescht nichts.
 *  6. Parameter wirken: mit erledigt_tage = 10 (gesetzt am Stichtag) faellt
 *     auch der 13-Tage-Eintrag — die Frist kommt aus parameter_wert.
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import { raeumeInboxAuf } from "../lib/inbox/aufbewahrung";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";

const P1 = "00000000-0000-4000-8000-00000000a2d0";
const AKTEUR = "00000000-0000-4000-8000-00000000a2d1";
const STROM = "00000000-0000-4000-8000-00000000a2d2";
const E = {
  erledigt13: "00000000-0000-4000-8000-00000000a2e1",
  erledigt14: "00000000-0000-4000-8000-00000000a2e2",
  verworfen14: "00000000-0000-4000-8000-00000000a2e3",
  gelesen59: "00000000-0000-4000-8000-00000000a2e4",
  gelesen60: "00000000-0000-4000-8000-00000000a2e5",
  ungelesen400: "00000000-0000-4000-8000-00000000a2e6",
  wirdFreiOffen: "00000000-0000-4000-8000-00000000a2e7",
  wirdFreiErledigt: "00000000-0000-4000-8000-00000000a2e8",
} as const;

async function main() {
  const ziel = new URL(url!);
  console.log(`AUFBEWAHRUNGSPROBE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };
  try {
    await db.transaction(async (tx) => {
      const x = async <T,>(q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
      const STICHTAG = (await x<{ heute: string }>(sql`select (now() at time zone 'Europe/Berlin')::date::text as heute`))[0]!.heute;
      console.log(`AUFBEWAHRUNGSPROBE stichtag=${STICHTAG}`);
      await x(sql`insert into benutzer (id, email, name, rolle, aktiv) values (${P1}, 'aufbewahrung-p1@example.invalid', 'Probe Pruefer', 'pruefer', true)`);
      await x(sql`insert into akteur (id, name, sektor, status, sitz_plz, sitz_ort) values (${AKTEUR}, 'Probe Akteur Aufbewahrung', 'ohne_sektor', 'entwurf', '00000', 'Probe')`);
      const [mat] = await x<{ code: string }>(sql`select code from materialart order by code limit 1`);
      await x(sql`insert into biomassestrom (id, akteur_id, materialart_code, menge_roh_fm, zeitraum_von, zeitraum_bis, saisonalitaet, status)
        values (${STROM}, ${AKTEUR}, ${mat!.code}, 100, '2020-01-01', '2035-12-31', '[100,100,100,100,100,100,100,100,100,100,100,100]'::jsonb, 'entwurf')`);
      const [er] = await x<{ id: string }>(sql`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id) values ('biomassestrom', ${STROM}, 'Probe', 'geaendert', ${P1}) returning id`);
      // Zeitpunkt „vor n Tagen" um 12:00 Berlin — tagesgenau, fern der Mitternachtsgrenze.
      const vorTagen = (n: number) => sql`((${STICHTAG}::date - ${n})::timestamp + interval '12 hours') at time zone 'Europe/Berlin'`;
      const eintrag = (id: string, zustand: string, zustandVor: number, gelesenVor: number | null) => sql`
        insert into inbox_eintrag (id, empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id, erstellt_am, aktualisiert_am, gelesen_am, zustand, zustand_seit)
        values (${id}, ${P1}, ${P1}, 'aenderung_eintrag', ${STROM}, ${er!.id}, ${vorTagen(Math.max(zustandVor, gelesenVor ?? 0, 1))}, ${vorTagen(Math.max(zustandVor, gelesenVor ?? 0, 1))},
                ${gelesenVor == null ? sql`null` : vorTagen(gelesenVor)}, ${zustand}::inbox_zustand, ${vorTagen(zustandVor)})`;
      await x(eintrag(E.erledigt13, "erledigt", 13, 20));
      await x(eintrag(E.erledigt14, "erledigt", 14, 20));
      await x(eintrag(E.verworfen14, "verworfen", 14, 20));
      await x(eintrag(E.gelesen59, "offen", 70, 59));
      await x(eintrag(E.gelesen60, "offen", 70, 60));
      await x(eintrag(E.ungelesen400, "offen", 400, null));
      // AP2.8-Hinweise (zustandsbasiert, ohne Urheber): einer offen und alt gelesen, einer erledigt und alt.
      const wirdFrei = (id: string, zustand: string, stufe: number) => sql`
        insert into inbox_eintrag (id, empfaenger_id, ausloeser_id, typ, biomassestrom_id, ereignis_id, bezugsdatum, stufe, erstellt_am, aktualisiert_am, gelesen_am, zustand, zustand_seit)
        values (${id}, ${P1}, null, 'biomasse_wird_frei', ${STROM}, null, '2026-12-31', ${stufe}, ${vorTagen(400)}, ${vorTagen(400)}, ${vorTagen(400)}, ${zustand}::inbox_zustand, ${vorTagen(400)})`;
      await x(wirdFrei(E.wirdFreiOffen, "offen", 180));
      await x(wirdFrei(E.wirdFreiErledigt, "erledigt", 60));

      const uebrig = async () => new Set((await x<{ id: string }>(sql`select id from inbox_eintrag where empfaenger_id = ${P1}`)).map((z) => z.id));
      const vorher = await uebrig();
      pruefe("0 Probedaten: acht Eintraege", vorher.size === 8, vorher.size);

      const l1 = await raeumeInboxAuf(tx, STICHTAG);
      const nach1 = await uebrig();
      pruefe("1a erledigt 13 Tage bleibt, 14 Tage weg", nach1.has(E.erledigt13) && !nach1.has(E.erledigt14), { l1 });
      pruefe("1b verworfen 14 Tage weg (wie erledigt)", !nach1.has(E.verworfen14), l1.erledigt);
      pruefe("2 gelesen 59 Tage bleibt, 60 Tage weg", nach1.has(E.gelesen59) && !nach1.has(E.gelesen60), l1.gelesen);
      pruefe("3 ungelesen bleibt auch nach 400 Tagen", nach1.has(E.ungelesen400), [...nach1].length);
      pruefe("4 aktive und erledigte Wird-frei-Hinweise bleiben", nach1.has(E.wirdFreiOffen) && nach1.has(E.wirdFreiErledigt), null);
      pruefe("1c Zaehlung: 2 erledigt/verworfen, 1 gelesen", l1.erledigt === 2 && l1.gelesen === 1, l1);

      const l2 = await raeumeInboxAuf(tx, STICHTAG);
      pruefe("5 zweiter Lauf desselben Stichtags loescht nichts", l2.erledigt === 0 && l2.gelesen === 0 && (await uebrig()).size === nach1.size, l2);

      // 6. Parameter wirkt: Frist 10 Tage ab Stichtag → der 13-Tage-Eintrag faellt.
      await x(sql`insert into parameter_wert (schluessel, wert, gueltig_ab, begruendung, erstellt_von) values ('inbox.aufbewahrung_erledigt_tage', 10, ${STICHTAG}::date, 'Probe', ${P1})`);
      const l3 = await raeumeInboxAuf(tx, STICHTAG);
      pruefe("6 Parameter 10 Tage: der 13-Tage-Eintrag faellt jetzt", l3.erledigt === 1 && !(await uebrig()).has(E.erledigt13), l3);

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) {
      console.error("::error::AUFBEWAHRUNGSPROBE abgebrochen: " + (e instanceof Error ? e.message : String(e)));
      await verbindung.end();
      process.exit(1);
    }
  }
  await verbindung.end();
  if (fehler.length) {
    console.error("::error::AUFBEWAHRUNGSPROBE ROT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("AUFBEWAHRUNGSPROBE OK — alle Faelle zurueckgerollt.");
}

main();
