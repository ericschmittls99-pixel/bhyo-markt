/**
 * AP2.5 PR c (E66): dauerhafter DB-Check fuer Dubletten und Zusammenfuehren —
 * laeuft im Deploy-CI gegen die echte Preview-DB. Zusicherungen:
 *
 * 1. Struktur (Migration 0038): pg_trgm, Funktion akteur_name_norm, GIN-Index,
 *    Tabelle akteur_keine_dublette mit zwei FKs ON DELETE CASCADE, die beiden
 *    Ereignisarten, Trigger kontaktperson_kein_umhaengen mit der Ausnahme.
 * 2. Paritaet: akteur_name_norm liefert fuer jede Fixture dieselbe Form wie
 *    das TypeScript-Spiegelbild (dubletten-fixtures.ts, geteilt mit
 *    apps/web/lib/akteur-norm.test.ts); similarity() stimmt mit der
 *    nachgerechneten Aehnlichkeit ueberein — auch fuer die Kalibrier-Paare
 *    (echte Varianten, kommunale falsche Treffer).
 * 3. Regeln (jede Probe in einer zurueckgerollten Transaktion): Paar
 *    ungeordnet (a > b) abgewiesen, Paar doppelt abgewiesen, Umhaengen einer
 *    Kontaktperson OHNE Zusammenfuehrungs-Ereignis abgewiesen, MIT Ereignis
 *    derselben Transaktion erlaubt — und (Rot-Nachweis laut Auftrag) das
 *    Loeschen eines Akteurs, auf den ein Strom (Beleg, E48) verweist, weist
 *    die DB per Fremdschluessel ab.
 *
 * Kein Journal-Vergleich: hier werden keine wachsenden Zaehler verglichen,
 * nur benannte Objekte und Verhalten.
 */
import postgres from "postgres";

import { AEHNLICHKEIT_FIXTURES, KALIBRIER_PAARE, NORM_FIXTURES } from "./dubletten-fixtures";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });
const ROLLBACK = "__rollback__";

async function probe<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<{ ergebnis?: T; fehler?: string }> {
  let ergebnis: T | undefined;
  try {
    await sql.begin(async (tx) => {
      ergebnis = await fn(tx);
      throw new Error(ROLLBACK);
    });
  } catch (e) {
    if (!(e instanceof Error && e.message === ROLLBACK)) return { fehler: e instanceof Error ? e.message : String(e) };
  }
  return { ergebnis };
}

async function main() {
  const ziel = new URL(url!);
  console.log(`DUBLETTENCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Struktur
  const [ext] = await sql`select count(*)::int as n from pg_extension where extname = 'pg_trgm'`;
  const [fn] = await sql`select count(*)::int as n from pg_proc where proname = 'akteur_name_norm'`;
  const [idx] = await sql`select count(*)::int as n from pg_class where relname = 'akteur_name_norm_trgm_idx'`;
  const [tab] = await sql`select count(*)::int as n from information_schema.tables where table_name = 'akteur_keine_dublette'`;
  const [fks] = await sql`select count(*)::int as n from pg_constraint where conrelid = 'akteur_keine_dublette'::regclass and contype = 'f' and confdeltype = 'c'`;
  const [arten] = await sql`select count(*)::int as n from pg_enum where enumtypid = 'ereignis_art'::regtype and enumlabel in ('akteur_zusammengefuehrt', 'keine_dublette_markiert')`;
  const [trg] = await sql`select count(*)::int as n from pg_proc where proname = 'kontaktperson_kein_umhaengen' and prosrc like '%akteur_zusammengefuehrt%'`;
  console.log(`STRUKTUR pg_trgm=${ext!.n} funktion=${fn!.n} index=${idx!.n} tabelle=${tab!.n} fks=${fks!.n}/2 arten=${arten!.n}/2 trigger_ausnahme=${trg!.n}`);
  if (ext!.n !== 1 || fn!.n !== 1 || idx!.n !== 1 || tab!.n !== 1 || fks!.n !== 2 || arten!.n !== 2 || trg!.n !== 1) {
    console.error("::error::DUBLETTEN-CHECK VERLETZT (Migration 0038 fehlt): Extension / Funktion / Index / Tabelle / FKs / Arten / Trigger");
    await sql.end();
    process.exit(1);
  }

  // (2) Paritaet SQL ↔ TypeScript
  for (const [eingabe, erwartet] of NORM_FIXTURES) {
    const [r] = await sql`select akteur_name_norm(${eingabe}) as norm`;
    if (r!.norm !== erwartet) fehler.push(`Paritaet norm ${JSON.stringify(eingabe)}: SQL ${JSON.stringify(r!.norm)} ≠ TS ${JSON.stringify(erwartet)}`);
  }
  for (const [a, b, erwartet] of AEHNLICHKEIT_FIXTURES) {
    const [r] = await sql`select similarity(${a}, ${b})::float8 as sim`;
    if (Math.abs(Number(r!.sim) - erwartet) > 1e-6) fehler.push(`Paritaet similarity(${JSON.stringify(a)}, ${JSON.stringify(b)}): SQL ${r!.sim} ≠ TS ${erwartet}`);
  }
  for (const p of KALIBRIER_PAARE) {
    const [r] = await sql`select similarity(akteur_name_norm(${p.a}), akteur_name_norm(${p.b}))::float8 as sim`;
    if (Math.abs(Number(r!.sim) - p.aehnlichkeit) > 1e-6) fehler.push(`Paritaet Kalibrier-Paar ${JSON.stringify(p.a)} · ${JSON.stringify(p.b)}: SQL ${r!.sim} ≠ TS ${p.aehnlichkeit}`);
  }
  console.log(`PARITAET norm=${NORM_FIXTURES.length} similarity=${AEHNLICHKEIT_FIXTURES.length} kalibrier_paare=${KALIBRIER_PAARE.length} abweichungen=${fehler.length}`);

  // (3) Regeln
  const akteure = (await sql`select id from akteur order by created_at limit 2`) as unknown as { id: string }[];
  const [nutzer] = await sql`select id, email from benutzer order by email limit 1`;
  const [mitStrom] = await sql`select akteur_id from biomassestrom limit 1`;
  if (akteure.length < 2 || !nutzer) {
    console.log(`REGELN uebersprungen: akteure=${akteure.length} benutzer=${!!nutzer}`);
  } else {
    const [x, y] = [akteure[0]!.id, akteure[1]!.id].sort();
    const regel = async (name: string, fn: (tx: postgres.TransactionSql) => Promise<unknown>, erwartet: RegExp | null) => {
      const r = await probe(fn);
      const ok = erwartet ? !!r.fehler && erwartet.test(r.fehler) : !r.fehler;
      console.log(`REGEL ${name}: ${ok ? "OK" : "VERLETZT"}${r.fehler ? ` (${r.fehler.slice(0, 90)})` : ""}`);
      if (!ok) fehler.push(`Regel ${name}`);
    };
    await regel("Paar geordnet erlaubt", (tx) => tx`insert into akteur_keine_dublette (akteur_a, akteur_b) values (${x}, ${y})`, null);
    await regel("Paar ungeordnet (a > b) abgewiesen", (tx) => tx`insert into akteur_keine_dublette (akteur_a, akteur_b) values (${y}, ${x})`, /akteur_keine_dublette_ordnung_check/);
    await regel("Paar doppelt abgewiesen", async (tx) => {
      await tx`insert into akteur_keine_dublette (akteur_a, akteur_b) values (${x}, ${y})`;
      await tx`insert into akteur_keine_dublette (akteur_a, akteur_b) values (${x}, ${y})`;
    }, /akteur_keine_dublette_paar_uniq/);
    await regel("Umhaengen ohne Ereignis abgewiesen (Trigger)", async (tx) => {
      const [p] = await tx`insert into kontaktperson (akteur_id, name) values (${x}, 'Zyx Probe') returning id`;
      await tx`update kontaktperson set akteur_id = ${y} where id = ${p!.id}`;
    }, /nicht umgehaengt/);
    await regel("Umhaengen mit Ereignis akteur_zusammengefuehrt derselben Transaktion erlaubt", async (tx) => {
      const [p] = await tx`insert into kontaktperson (akteur_id, name) values (${x}, 'Zyx Probe') returning id`;
      await tx`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id)
               values ('akteur', ${x}, ${`${nutzer.email}: Quelle ${x} → Ziel ${y}`}, 'akteur_zusammengefuehrt', ${nutzer.id})`;
      await tx`update kontaktperson set akteur_id = ${y} where id = ${p!.id}`;
      const [k] = await tx`select akteur_id from kontaktperson where id = ${p!.id}`;
      if (k!.akteur_id !== y) throw new Error("akteur_id nicht umgehaengt");
    }, null);
    await regel("Ereignis fuer ein ANDERES Ziel genuegt nicht", async (tx) => {
      const [p] = await tx`insert into kontaktperson (akteur_id, name) values (${x}, 'Zyx Probe') returning id`;
      await tx`insert into aenderung (entitaet_typ, entitaet_id, text, art, benutzer_id)
               values ('akteur', ${x}, ${`${nutzer.email}: Quelle ${x} → Ziel 00000000-0000-4000-8000-000000000000`}, 'akteur_zusammengefuehrt', ${nutzer.id})`;
      await tx`update kontaktperson set akteur_id = ${y} where id = ${p!.id}`;
    }, /nicht umgehaengt/);
    // Rot-Nachweis laut Auftrag: Loeschen eines Akteurs mit Strom weist die DB ab.
    if (mitStrom) await regel("Loeschen eines Akteurs mit Strom abgewiesen (FK)", (tx) => tx`delete from akteur where id = ${mitStrom.akteur_id}`, /violates foreign key constraint/);
    else console.log("REGEL Loeschen mit Strom uebersprungen: kein Strom");
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::DUBLETTEN-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("DUBLETTENCHECK OK");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
