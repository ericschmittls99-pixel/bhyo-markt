/**
 * AP2.6 PR a (E71): Probe des Kommentar-Modells und -Schreibwegs gegen eine
 * Datenbank mit allen Migrationen (CI-Job wegwerf-db: leere PostGIS, nichts
 * bleibt; auch gegen die Preview lauffaehig). Eigene Probedaten in EINER
 * zurueckgerollten Transaktion; erwartete Abweisungen laufen in Savepoints.
 *
 *  1. CHECK genau ein Bezug (Migration 0052): Strom ja, Akteur ja, beide nein,
 *     keiner nein.
 *  2. CHECK Text: leer nein, 2001 Zeichen nein, geloescht ohne NULL-Text nein,
 *     NULL-Text ohne geloescht_am nein.
 *  3. Erwaehnung: PK (kommentar, nutzer) doppelt nein; unbekannter Nutzer nein.
 *  4. Schreibweg (echte Bausteine, echte Matrix): Betrachter abgewiesen;
 *     Bearbeiter kommentiert den von einem Admin GESPERRTEN Strom (E44 zaehlt
 *     nicht) mit Erwaehnung des Admins → Zeile, Erwaehnung, Ereignis
 *     kommentar_erstellt; Marker auf Betrachterin / fremde UUID abgewiesen.
 *  5. Bearbeiten: fremd (auch admin) abgewiesen; Autor ergaenzt eine
 *     Erwaehnung → nur die neue Zeile kommt dazu, bearbeitet_am gesetzt.
 *  6. Loeschen: bearbeiter fremd nein, admin fremd ja (weich: text NULL,
 *     geloescht_am), erneut nein; Erwaehnungen bleiben.
 *  7. Kein Kommentartext im Protokoll: der Sentinel-Text steht in keiner
 *     aenderung-Zeile (Rot-Nachweis: eine gefaelschte Zeile wird gefunden).
 *  8. Loeschverhalten: ein verwaister Akteur wird geloescht → seine
 *     Kommentare und Erwaehnungen sind per CASCADE weg.
 */
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";

import { erwaehnungsMarker } from "../lib/kommentar-marker";
import { KEIN_RECHT, NICHT_ERWAEHNBAR, kommentarBearbeitenInTx, kommentarErstellenInTx, kommentarLoeschenInTx } from "../lib/kommentar-schreibweg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const verbindung = createSql(url, { max: 1 });
const db = drizzle(verbindung, { schema });
const ROLLBACK = "__rollback__";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ADMIN = "00000000-0000-4000-8000-00000000a260";
const BEARB = "00000000-0000-4000-8000-00000000a261";
const BETR = "00000000-0000-4000-8000-00000000a262";
const PRUEF = "00000000-0000-4000-8000-00000000a263";
const AKTEUR = "00000000-0000-4000-8000-00000000a264";
const AKTEUR2 = "00000000-0000-4000-8000-00000000a265";
const STROM = "00000000-0000-4000-8000-00000000a266";
const FREMD = "00000000-0000-4000-8000-00000000a2ff";
const SENTINEL = "KOMMENTARPROBE-GEHEIM-7c1e";

const admin = { id: ADMIN, email: "kprobe-admin@example.invalid", rolle: "admin" as const };
const bearbeiter = { id: BEARB, email: "kprobe-bearb@example.invalid", rolle: "bearbeiter" as const };
const betrachterin = { id: BETR, email: "kprobe-betr@example.invalid", rolle: "betrachter" as const };
const pruefer = { id: PRUEF, email: "kprobe-pruef@example.invalid", rolle: "pruefer" as const };

async function main() {
  const ziel = new URL(url!);
  console.log(`KOMMENTARPROBE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];
  const pruefe = (name: string, ok: boolean, ist: unknown) => {
    console.log(`${ok ? "OK " : "ROT"} ${name}: ${JSON.stringify(ist)}`);
    if (!ok) fehler.push(name);
  };
  /**
   * Erwartete Abweisung in einem Savepoint: liefert die Fehlermeldung oder
   * null (= durchgekommen). Drizzle verpackt DB-Fehler als „Failed query: …"
   * — der Constraint-Name steht in `cause` (dem Postgres-Fehler), deshalb
   * wird die Ursache bevorzugt.
   */
  const scheitert = async (tx: Tx, fn: (sp: Tx) => Promise<unknown>): Promise<string | null> => {
    try {
      await tx.transaction(async (sp) => {
        await fn(sp);
      });
      return null;
    } catch (e) {
      const ursache = e instanceof Error && e.cause instanceof Error ? e.cause.message : null;
      return ursache ?? (e instanceof Error ? e.message : String(e));
    }
  };
  try {
    await db.transaction(async (tx) => {
      const x = async <T,>(q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];
      await x(sql`insert into benutzer (id, email, name, rolle, aktiv) values
        (${ADMIN}, ${admin.email}, 'Probe Admin', 'admin', true),
        (${BEARB}, ${bearbeiter.email}, 'Probe Bearbeiter', 'bearbeiter', true),
        (${BETR}, ${betrachterin.email}, 'Probe Betrachterin', 'betrachter', true),
        (${PRUEF}, ${pruefer.email}, 'Probe Pruefer', 'pruefer', true)`);
      await x(sql`insert into akteur (id, name, sektor, status, sitz_plz, sitz_ort) values
        (${AKTEUR}, 'Probe Akteur Kommentar', 'ohne_sektor', 'entwurf', '00000', 'Probe'),
        (${AKTEUR2}, 'Probe Akteur verwaist', 'ohne_sektor', 'entwurf', '00000', 'Probe')`);
      const [mat] = await x<{ code: string }>(sql`select code from materialart order by code limit 1`);
      await x(sql`insert into biomassestrom (id, akteur_id, materialart_code, menge_roh_fm, zeitraum_von, zeitraum_bis, saisonalitaet, status, gesperrt_von, gesperrt_am)
        values (${STROM}, ${AKTEUR}, ${mat!.code}, 100, '2020-01-01', '2035-12-31', '[100,100,100,100,100,100,100,100,100,100,100,100]'::jsonb, 'entwurf', ${ADMIN}, now())`);

      // 1. CHECK genau ein Bezug
      const roh = (strom: string | null, akteur: string | null, text = "ok") =>
        sql`insert into kommentar (biomassestrom_id, akteur_id, autor_id, text) values (${strom}::uuid, ${akteur}::uuid, ${ADMIN}, ${text})`;
      pruefe("1a Strom-Bezug zugelassen", (await scheitert(tx, (sp) => sp.execute(roh(STROM, null)))) === null, "insert");
      pruefe("1b Akteur-Bezug zugelassen", (await scheitert(tx, (sp) => sp.execute(roh(null, AKTEUR)))) === null, "insert");
      const beide = await scheitert(tx, (sp) => sp.execute(roh(STROM, AKTEUR)));
      pruefe("1c beide Bezuege abgewiesen", /genau_ein_bezug/.test(beide ?? ""), beide);
      const keiner = await scheitert(tx, (sp) => sp.execute(roh(null, null)));
      pruefe("1d kein Bezug abgewiesen", /genau_ein_bezug/.test(keiner ?? ""), keiner);

      // 2. CHECK Text
      const leer = await scheitert(tx, (sp) => sp.execute(roh(null, AKTEUR, "   ")));
      pruefe("2a leerer Text abgewiesen", /text_check/.test(leer ?? ""), leer);
      const lang = await scheitert(tx, (sp) => sp.execute(roh(null, AKTEUR, "x".repeat(2001))));
      pruefe("2b 2001 Zeichen abgewiesen", /text_check/.test(lang ?? ""), lang);
      const gelMitText = await scheitert(tx, (sp) =>
        sp.execute(sql`insert into kommentar (akteur_id, autor_id, text, geloescht_am) values (${AKTEUR}, ${ADMIN}, 'noch da', now())`),
      );
      pruefe("2c geloescht_am mit Text abgewiesen", /text_check/.test(gelMitText ?? ""), gelMitText);
      const nullOhneGel = await scheitert(tx, (sp) => sp.execute(sql`insert into kommentar (akteur_id, autor_id, text) values (${AKTEUR}, ${ADMIN}, null)`));
      pruefe("2d NULL-Text ohne geloescht_am abgewiesen", /text_check/.test(nullOhneGel ?? ""), nullOhneGel);

      // 4. Schreibweg
      const betr = await scheitert(tx, (sp) => kommentarErstellenInTx(sp, betrachterin, { art: "biomasse", id: STROM }, "Hallo"));
      pruefe("4a Betrachterin abgewiesen", betr === KEIN_RECHT, betr);
      const k1 = await kommentarErstellenInTx(tx, bearbeiter, { art: "biomasse", id: STROM }, `${SENTINEL} bitte ${erwaehnungsMarker(ADMIN)} prüfen`);
      const z1 = await x<{ autor_id: string; text: string; biomassestrom_id: string; n_erw: number; erw: string[] }>(
        sql`select k.autor_id, k.text, k.biomassestrom_id, (select count(*)::int from kommentar_erwaehnung e where e.kommentar_id = k.id) as n_erw,
            (select coalesce(array_agg(e.nutzer_id::text), '{}') from kommentar_erwaehnung e where e.kommentar_id = k.id) as erw
            from kommentar k where k.id = ${k1.id}`,
      );
      pruefe("4b Bearbeiter kommentiert den vom Admin gesperrten Strom (E44 zaehlt nicht), Erwaehnung des Admins gespeichert", z1[0]?.autor_id === BEARB && z1[0]?.biomassestrom_id === STROM && z1[0]?.n_erw === 1 && k1.erwaehnte.join() === ADMIN, z1[0]);
      const e1 = await x<{ art: string; entitaet_typ: string; text: string }>(sql`select art::text, entitaet_typ, text from aenderung where entitaet_id = ${k1.id}`);
      pruefe("4c Ereignis kommentar_erstellt mit Objektbezug kommentar, Text nur Bezug-ID und Zaehler", e1.length === 1 && e1[0]!.art === "kommentar_erstellt" && e1[0]!.entitaet_typ === "kommentar" && e1[0]!.text.endsWith(`Strom ${STROM}; 1 Erwähnung(en)`), e1);
      const mBetr = await scheitert(tx, (sp) => kommentarErstellenInTx(sp, bearbeiter, { art: "akteur", id: AKTEUR }, `Hallo ${erwaehnungsMarker(BETR)}`));
      pruefe("4d Marker auf Betrachterin abgewiesen", mBetr === NICHT_ERWAEHNBAR, mBetr);
      const mFremd = await scheitert(tx, (sp) => kommentarErstellenInTx(sp, bearbeiter, { art: "akteur", id: AKTEUR }, `Hallo ${erwaehnungsMarker(FREMD)}`));
      pruefe("4e Marker auf fremde UUID abgewiesen", mFremd === NICHT_ERWAEHNBAR, mFremd);

      // 3. Erwaehnung: PK und FK
      const dop = await scheitert(tx, (sp) => sp.execute(sql`insert into kommentar_erwaehnung (kommentar_id, nutzer_id) values (${k1.id}, ${ADMIN})`));
      pruefe("3a doppelte Erwaehnung (PK) abgewiesen", /kommentar_erwaehnung_kommentar_id_nutzer_id_pk|duplicate key/.test(dop ?? ""), dop);
      const fk = await scheitert(tx, (sp) => sp.execute(sql`insert into kommentar_erwaehnung (kommentar_id, nutzer_id) values (${k1.id}, ${FREMD})`));
      pruefe("3b Erwaehnung eines unbekannten Nutzers (FK) abgewiesen", /nutzer_id_benutzer_id_fk|foreign key/.test(fk ?? ""), fk);

      // 5. Bearbeiten
      const fremdAdmin = await scheitert(tx, (sp) => kommentarBearbeitenInTx(sp, admin, k1.id, "Admin ändert fremden"));
      pruefe("5a admin bearbeitet fremden Kommentar nicht", fremdAdmin === KEIN_RECHT, fremdAdmin);
      const b1 = await kommentarBearbeitenInTx(tx, bearbeiter, k1.id, `${SENTINEL} bitte ${erwaehnungsMarker(PRUEF)} prüfen`); // ADMIN entfernt, PRUEF neu
      const z2 = await x<{ bearbeitet: boolean; erw: string[] }>(
        sql`select (bearbeitet_am is not null) as bearbeitet,
            (select coalesce(array_agg(e.nutzer_id::text order by e.nutzer_id), '{}') from kommentar_erwaehnung e where e.kommentar_id = k.id) as erw
            from kommentar k where k.id = ${k1.id}`,
      );
      const erw = Array.isArray(z2[0]?.erw) ? z2[0]!.erw : String(z2[0]?.erw ?? "").replace(/[{}]/g, "").split(",").filter(Boolean);
      pruefe("5b Autor bearbeitet: neue Erwaehnung kommt dazu, entfernte bleibt, bearbeitet_am gesetzt", b1.neueErwaehnte.join() === PRUEF && z2[0]?.bearbeitet === true && erw.length === 2 && erw.includes(ADMIN) && erw.includes(PRUEF), { b1, z2: z2[0] });

      // 6. Loeschen
      const k2 = await kommentarErstellenInTx(tx, admin, { art: "akteur", id: AKTEUR }, `${SENTINEL} vom Admin`);
      const lBearb = await scheitert(tx, (sp) => kommentarLoeschenInTx(sp, bearbeiter, k2.id));
      pruefe("6a bearbeiter loescht fremden Kommentar nicht", lBearb === KEIN_RECHT, lBearb);
      const lPruef = await scheitert(tx, (sp) => kommentarLoeschenInTx(sp, pruefer, k2.id));
      pruefe("6b pruefer loescht fremden Kommentar nicht", lPruef === KEIN_RECHT, lPruef);
      await kommentarLoeschenInTx(tx, admin, k1.id); // admin loescht fremden (von BEARB)
      const z3 = await x<{ text: string | null; geloescht: boolean; n_erw: number }>(
        sql`select text, (geloescht_am is not null) as geloescht, (select count(*)::int from kommentar_erwaehnung e where e.kommentar_id = k.id) as n_erw from kommentar k where k.id = ${k1.id}`,
      );
      pruefe("6c admin loescht fremden weich: text NULL, geloescht_am gesetzt, Zeile und Erwaehnungen bleiben", z3[0]?.text === null && z3[0]?.geloescht === true && z3[0]?.n_erw === 2, z3[0]);
      const nochmal = await scheitert(tx, (sp) => kommentarLoeschenInTx(sp, admin, k1.id));
      pruefe("6d erneutes Loeschen abgewiesen", nochmal === "Der Kommentar ist bereits gelöscht.", nochmal);
      // Innerhalb EINER Transaktion ist now() konstant — die Reihenfolge ist nicht pruefbar, die Menge schon.
      const e3 = await x<{ art: string }>(sql`select art::text from aenderung where entitaet_id = ${k1.id} order by art`);
      pruefe("6e drei Ereignisse: erstellt, bearbeitet, geloescht (je genau eins)", e3.map((e) => e.art).join(",") === "kommentar_bearbeitet,kommentar_erstellt,kommentar_geloescht", e3);

      // 7. Kein Kommentartext im Protokoll (und Rot-Nachweis der Suche)
      const treffer = await x<{ n: number }>(sql`select count(*)::int as n from aenderung where text like ${"%" + SENTINEL + "%"}`);
      pruefe("7a Sentinel-Text steht in keiner Protokollzeile", treffer[0]?.n === 0, treffer[0]);
      const rot = await scheitert(tx, async (sp) => {
        await sp.execute(sql`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id) values ('kommentar', ${k2.id}, ${"gefaelscht " + SENTINEL}, 'kommentar_erstellt', ${ADMIN})`);
        const [t] = (await sp.execute(sql`select count(*)::int as n from aenderung where text like ${"%" + SENTINEL + "%"}`)) as unknown as { n: number }[];
        if (t!.n !== 1) throw new Error(`Suche findet ${t!.n}`);
        throw new Error("gefunden");
      });
      pruefe("7b Rot-Nachweis: eine gefaelschte Zeile mit dem Text wird gefunden", rot === "gefunden", rot);

      // 8. Loeschverhalten: verwaister Akteur weg → Kommentare per CASCADE weg
      const k3 = await kommentarErstellenInTx(tx, pruefer, { art: "akteur", id: AKTEUR2 }, `${SENTINEL} am verwaisten Akteur ${erwaehnungsMarker(BEARB)}`);
      const stromVorher = (await x<{ n: number }>(sql`select count(*)::int as n from kommentar where biomassestrom_id = ${STROM}`))[0]!.n;
      await x(sql`delete from akteur where id = ${AKTEUR2}`);
      const rest = await x<{ k: number; e: number; strom: number }>(
        sql`select (select count(*)::int from kommentar where id = ${k3.id}) as k,
                   (select count(*)::int from kommentar_erwaehnung where kommentar_id = ${k3.id}) as e,
                   (select count(*)::int from kommentar where biomassestrom_id = ${STROM}) as strom`,
      );
      pruefe("8 Akteur geloescht: Kommentar und Erwaehnung per CASCADE weg; Strom-Kommentare unberuehrt", rest[0]?.k === 0 && rest[0]?.e === 0 && rest[0]?.strom === stromVorher && stromVorher > 0, { ...rest[0], stromVorher });

      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ROLLBACK) {
      console.error("::error::KOMMENTARPROBE abgebrochen: " + (e instanceof Error ? e.message : String(e)));
      await verbindung.end();
      process.exit(1);
    }
  }
  await verbindung.end();
  if (fehler.length) {
    console.error("::error::KOMMENTARPROBE ROT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("KOMMENTARPROBE OK — alle Faelle zurueckgerollt.");
}

main();
