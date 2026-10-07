/**
 * AP2.8 (E70): Probe des Wird-frei-Schritts im taeglichen Job gegen eine
 * Datenbank mit allen Migrationen (CI-Job wegwerf-db: leere PostGIS, nichts
 * bleibt; auch gegen die Preview lauffaehig). Legt in EINER zurueckgerollten
 * Transaktion eigene Probedaten an (Benutzer, Akteur, Stroeme, Vergaben) und
 * prueft die SQL-Spiegelung von lib/wird-frei.ts an denselben Faellen wie
 * lib/wird-frei.test.ts:
 *
 *  1. Stufenwechsel 181→180, 61→60, 31→30, 1→0 — je Grenze erst nichts bzw.
 *     die alte Stufe, dann die neue; die Vorstufe wird abgeraeumt (erledigt);
 *     hoechstens ein offener Eintrag je Strom.
 *  2. Einstieg bei 45 Resttagen = Stufe 60, keine nachgeholte 180.
 *  3. Ausfall ueber eine Stufengrenze: Laeufe an 61 und 29 → der zweite Lauf
 *     setzt 30, die 60 ist erledigt, keine nachgeholte Zwischenstufe.
 *  4. Erledigter Eintrag (vom Nutzer) wird fuer denselben Schluessel nicht
 *     neu erzeugt.
 *  5. Anschlussvergabe: Luecke 0 schliesst an (Kettenende der zweiten
 *     Vergabe), Luecke 1 und 2 nicht.
 *  6. vergeben_bis NULL → kein Hinweis; an_bhyo → Hinweis (Textvariante ist
 *     Sache des Registers).
 *  7. frei_ab aendert sich (Vergabe verlaengert) → alte Eintraege erledigt,
 *     neuer Eintrag zum neuen frei_ab.
 *  8. Zwei Laeufe desselben Stichtags: idempotent.
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

type Zeile = { biomassestrom_id: string; bezugsdatum: string; stufe: number; zustand: string; empfaenger_id: string };

async function main() {
  const ziel = new URL(url!);
  console.log(`WIRDFREIPROBE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };
  try {
    await db.transaction(async (tx) => {
      const x = async <T,>(q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
      // Probedaten: zwei Pruefer, ein Akteur, Stroeme je Fall. Stichtag frei waehlbar (Kalenderdaten).
      const P1 = "00000000-0000-4000-8000-00000000a280";
      const P2 = "00000000-0000-4000-8000-00000000a281";
      await x(sql`insert into benutzer (id, email, name, rolle, aktiv) values (${P1}, 'wirdfrei-p1@example.invalid', 'Probe Pruefer 1', 'pruefer', true), (${P2}, 'wirdfrei-p2@example.invalid', 'Probe Pruefer 2', 'admin', true)`);
      const A = "00000000-0000-4000-8000-00000000a282";
      await x(sql`insert into akteur (id, name, sektor, status, sitz_plz, sitz_ort) values (${A}, 'Probe Akteur wird frei', 'ohne_sektor', 'entwurf', '00000', 'Probe')`);
      const [mat] = await x<{ code: string }>(sql`select code from materialart order by code limit 1`);
      const strom = async (id: string) => {
        await x(sql`insert into biomassestrom (id, akteur_id, materialart_code, menge_roh_fm, zeitraum_von, zeitraum_bis, saisonalitaet, status)
          values (${id}, ${A}, ${mat!.code}, 100, '2020-01-01', '2035-12-31', '[100,100,100,100,100,100,100,100,100,100,100,100]'::jsonb, 'entwurf')`);
        // letzter Pruefer = P1, damit der Einzelempfaenger greift
        await x(sql`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id) values ('biomassestrom', ${id}, 'Probe', 'geprueft', ${P1})`);
      };
      const vergabe = async (stromId: string, von: string | null, bis: string | null, anBhyo = false) =>
        x(sql`insert into vergabe_zeitraum (biomassestrom_id, vergeben_von, vergeben_bis, vergeben_an, an_bhyo) values (${stromId}, ${von}::date, ${bis}::date, 'Probe', ${anBhyo})`);
      const lauf = (stichtag: string) => stelleVerifikationsHinweiseZu(tx, stichtag);
      const zeilen = async (stromId: string) =>
        x<Zeile>(sql`select biomassestrom_id, bezugsdatum::text as bezugsdatum, stufe, zustand::text as zustand, empfaenger_id
                       from inbox_eintrag where typ::text = 'biomasse_wird_frei' and biomassestrom_id = ${stromId} order by stufe desc, zustand`);
      const offen = async (stromId: string) => (await zeilen(stromId)).filter((z) => z.zustand === "offen");

      // Alle Faelle enden am 30.06.2026 (frei ab 01.07.2026). Resttage = 2026-06-30 − Stichtag.
      const S1 = "00000000-0000-4000-8000-000000000001"; // Stufenwechsel
      await strom(S1);
      await vergabe(S1, "2025-01-01", "2026-06-30");
      await lauf("2025-12-31"); // 181 Tage → nichts
      pruefe("1a 181 Resttage: kein Hinweis", (await zeilen(S1)).length === 0, await zeilen(S1));
      const l180 = await lauf("2026-01-01"); // 180 → Stufe 180 an P1
      let o = await offen(S1);
      pruefe("1b 180 Resttage: Stufe 180 an den letzten Pruefer", l180.wirdFrei === 1 && o.length === 1 && o[0]!.stufe === 180 && o[0]!.empfaenger_id === P1 && o[0]!.bezugsdatum === "2026-06-30", o);
      await lauf("2026-04-30"); // 61 → bleibt 180
      o = await offen(S1);
      pruefe("1c 61 Resttage: noch Stufe 180", o.length === 1 && o[0]!.stufe === 180, o);
      await lauf("2026-05-01"); // 60 → Stufe 60, 180 erledigt
      o = await offen(S1);
      pruefe("1d 60 Resttage: Stufe 60 offen, 180 erledigt, genau ein offener", o.length === 1 && o[0]!.stufe === 60 && (await zeilen(S1)).some((z) => z.stufe === 180 && z.zustand === "erledigt"), await zeilen(S1));
      await lauf("2026-05-31"); // 30
      o = await offen(S1);
      pruefe("1e 31→30: Stufe 30", o.length === 1 && o[0]!.stufe === 30, o);
      await lauf("2026-06-29"); // 1 → 30 bleibt
      o = await offen(S1);
      pruefe("1f 1 Resttag: noch Stufe 30", o.length === 1 && o[0]!.stufe === 30, o);
      await lauf("2026-06-30"); // 0 → Stufe 0
      o = await offen(S1);
      pruefe("1g 0 Resttage: Stufe 0 „frei seit“", o.length === 1 && o[0]!.stufe === 0, o);
      const l8 = await lauf("2026-06-30");
      pruefe("8 zweiter Lauf desselben Stichtags: nichts", l8.wirdFrei === 0 && l8.wirdFreiAbgeraeumt === 0 && (await offen(S1)).length === 1, l8);
      await lauf("2026-12-01"); // frei seit bleibt (Regel 7)
      pruefe("7a Stufe 0 bleibt ohne neue Vergabe", (await offen(S1)).length === 1 && (await offen(S1))[0]!.stufe === 0, await offen(S1));

      // 2. Einstieg bei 45 Resttagen
      const S2 = "00000000-0000-4000-8000-000000000002";
      await strom(S2);
      await vergabe(S2, "2025-01-01", "2026-06-30");
      await lauf("2026-05-16"); // 45
      o = await offen(S2);
      pruefe("2 Einstieg bei 45 Resttagen: Stufe 60, keine 180", o.length === 1 && o[0]!.stufe === 60 && !(await zeilen(S2)).some((z) => z.stufe === 180), await zeilen(S2));

      // 3. Ausfall ueber eine Stufengrenze: 61 → (Ausfall) → 29
      const S3 = "00000000-0000-4000-8000-000000000003";
      await strom(S3);
      await vergabe(S3, "2025-01-01", "2026-06-30");
      await lauf("2026-04-30"); // 61 → 180
      await lauf("2026-06-01"); // 29 → 30, die 60 wird nicht nachgeholt
      const z3 = await zeilen(S3);
      pruefe("3 Ausfall ueber Grenze: 180 erledigt, 30 offen, keine 60", z3.length === 2 && z3.some((z) => z.stufe === 180 && z.zustand === "erledigt") && z3.some((z) => z.stufe === 30 && z.zustand === "offen"), z3);

      // 4. Vom Nutzer erledigt → nicht neu erzeugt
      await x(sql`update inbox_eintrag set zustand = 'erledigt', zustand_seit = now() where biomassestrom_id = ${S3} and stufe = 30`);
      const l4 = await lauf("2026-06-02");
      pruefe("4 erledigter Eintrag wird fuer denselben Schluessel nicht neu erzeugt", (await offen(S3)).length === 0 && l4.wirdFrei === 0, { l4, zeilen: await zeilen(S3) });

      // 5. Anschlussvergabe Luecke 0 / 1 / 2
      const S5a = "00000000-0000-4000-8000-00000000005a", S5b = "00000000-0000-4000-8000-00000000005b", S5c = "00000000-0000-4000-8000-00000000005c";
      for (const [id, von] of [[S5a, "2026-07-01"], [S5b, "2026-07-02"], [S5c, "2026-07-03"]] as const) {
        await strom(id);
        await vergabe(id, "2025-01-01", "2026-06-30");
        await vergabe(id, von, "2026-12-31");
      }
      await lauf("2026-06-01"); // 29 Tage bis 30.06.; 213 bis 31.12.
      pruefe("5a Luecke 0: Kette bis 31.12. → 213 Resttage, kein Hinweis", (await offen(S5a)).length === 0, await zeilen(S5a));
      pruefe("5b Luecke 1 (ein freier Tag): frei_ab 30.06., Stufe 30", (await offen(S5b)).some((z) => z.bezugsdatum === "2026-06-30" && z.stufe === 30), await zeilen(S5b));
      pruefe("5c Luecke 2: frei_ab 30.06., Stufe 30", (await offen(S5c)).some((z) => z.bezugsdatum === "2026-06-30" && z.stufe === 30), await zeilen(S5c));

      // 6. vergeben_bis NULL → nichts; an_bhyo → Hinweis
      const S6a = "00000000-0000-4000-8000-00000000006a", S6b = "00000000-0000-4000-8000-00000000006b";
      await strom(S6a); await vergabe(S6a, "2025-01-01", null);
      await strom(S6b); await vergabe(S6b, "2025-01-01", "2026-06-30", true);
      await lauf("2026-06-01");
      pruefe("6a vergeben_bis NULL: kein Hinweis", (await zeilen(S6a)).length === 0, await zeilen(S6a));
      pruefe("6b an_bhyo: Hinweis Stufe 30", (await offen(S6b)).some((z) => z.stufe === 30), await zeilen(S6b));

      // 7. frei_ab aendert sich: Vergabe verlaengert → alte Eintraege erledigt, neuer Eintrag
      await x(sql`update vergabe_zeitraum set vergeben_bis = '2026-08-15' where biomassestrom_id = ${S6b}`);
      const l7 = await lauf("2026-06-01"); // 75 Tage → Stufe 180 zum neuen frei_ab
      const z7 = await zeilen(S6b);
      pruefe("7b frei_ab verlaengert: alter Eintrag erledigt, neuer zum 15.08. mit Stufe 180", l7.wirdFreiAbgeraeumt >= 1 && z7.some((z) => z.bezugsdatum === "2026-06-30" && z.zustand === "erledigt") && z7.some((z) => z.bezugsdatum === "2026-08-15" && z.stufe === 180 && z.zustand === "offen") && (await offen(S6b)).length === 1, z7);
      // Vergabe geloescht → kein frei_ab mehr → alles erledigt
      await x(sql`delete from vergabe_zeitraum where biomassestrom_id = ${S6b}`);
      await lauf("2026-06-01");
      pruefe("7c Vergabe geloescht: keine offenen Hinweise", (await offen(S6b)).length === 0, await zeilen(S6b));

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) {
      console.error("::error::WIRDFREIPROBE abgebrochen: " + (e instanceof Error ? e.message : String(e)));
      await verbindung.end();
      process.exit(1);
    }
  }
  await verbindung.end();
  if (fehler.length) {
    console.error("::error::WIRDFREIPROBE ROT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("WIRDFREIPROBE OK — alle Faelle zurueckgerollt.");
}

main();
