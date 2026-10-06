/**
 * AP2.7 PR a (E67): DB-Check des Import-Datenmodells gegen die echte Preview-DB
 * (Deploy-CI, nur in zurueckgerollten Transaktionen).
 * 1. Struktur (Migration 0043): drei Tabellen, zwei Enum-Werte, Lauf-ID-Spalten,
 *    Index inbox_eintrag_import_uidx, CHECK import_zeile_felder_check.
 * 2. Schema-Probe: keine Spalte der Import-Tabellen mit Personen-Bezug.
 * 3. Rot-Nachweis am CHECK: eine Zeile mit Schluessel „email" in felder wird
 *    abgewiesen; ohne den Schluessel wird sie angenommen (zurueckgerollt).
 */
import postgres from "postgres";

import { journalModus, modusText, zaehlerPasst } from "./journal-vergleich";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });
const ROLLBACK = "IMPORTCHECK_ROLLBACK";

async function main() {
  const ziel = new URL(url!);
  console.log(`IMPORTCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const modus = await journalModus(sql, url!);
  console.log(`JOURNAL ${modusText(modus)}`);
  if (modus.modus === "rot") {
    console.error("::error::IMPORTCHECK: Journal und Datenbank passen nicht zusammen.");
    process.exit(1);
  }
  const fehler: string[] = [];

  const [t] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('import_vorlage', 'import_lauf', 'import_zeile')`;
  const [e] = await sql`select count(*)::int as n from pg_enum e join pg_type t on t.oid = e.enumtypid
    where (t.typname = 'ereignis_art' and e.enumlabel = 'kontaktdaten_uebersprungen') or (t.typname = 'inbox_typ' and e.enumlabel = 'import_abgeschlossen')`;
  const [c] = await sql`select count(*)::int as n from information_schema.columns where table_name in ('aenderung', 'inbox_eintrag') and column_name = 'import_lauf_id'`;
  const [i] = await sql`select count(*)::int as n from pg_indexes where indexname = 'inbox_eintrag_import_uidx'`;
  const [k] = await sql`select count(*)::int as n from pg_constraint where conname = 'import_zeile_felder_check'`;
  const struktur = { tabellen: t!.n, enum_werte: e!.n, lauf_id_spalten: c!.n, index: i!.n, check: k!.n };
  console.log("STRUKTUR " + JSON.stringify(struktur));
  const m = modus.modus === "mindest" ? "mindest" : "exakt";
  for (const [name, ist, soll] of [["tabellen", struktur.tabellen, 3], ["enum_werte", struktur.enum_werte, 2], ["lauf_id_spalten", struktur.lauf_id_spalten, 2], ["index", struktur.index, 1], ["check", struktur.check, 1]] as const) {
    const f = zaehlerPasst(name, ist, soll, m);
    if (f) fehler.push(f);
  }

  const personen = await sql`select table_name, column_name from information_schema.columns
    where table_schema = 'public' and table_name in ('import_vorlage', 'import_lauf', 'import_zeile')
      and column_name <> 'dateiname' and column_name ~* '(ansprech|kontakt|person|mail|telefon|mobil|handy|fax|name)'`;
  console.log("PERSONEN_SPALTEN " + JSON.stringify(personen));
  if (personen.length > 0) fehler.push(`Personen-Spalten in Import-Tabellen: ${personen.map((p) => `${p.table_name}.${p.column_name}`).join(", ")}`);

  if (struktur.check === 1) {
    const probe = async (felder: string): Promise<"angenommen" | "abgewiesen"> => {
      try {
        await sql.begin(async (tx) => {
          const [b] = await tx`select id from benutzer limit 1`;
          if (!b) throw new Error(ROLLBACK + ":kein_benutzer");
          const [lauf] = await tx`insert into import_lauf (art, dateiname, datei_hash, beleg_typ, standard_sektor, ersteller_id)
            values ('biomasse', 'import-check.xlsx', repeat('0', 64), 'betriebsdaten', 'ohne_sektor', ${b.id}) returning id`;
          await tx`insert into import_zeile (lauf_id, zeilennummer, felder) values (${lauf!.id}, 1, ${felder}::jsonb)`;
          throw new Error(ROLLBACK);
        });
        return "angenommen";
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        if (m === ROLLBACK) return "angenommen";
        if (m.startsWith(ROLLBACK)) throw err;
        return "abgewiesen";
      }
    };
    const mitEmail = await probe('{"bezeichnung": "Hof A", "email": "x@y.z"}');
    const ohne = await probe('{"bezeichnung": "Hof A", "plz": "67346"}');
    console.log(`PROBE felder_mit_email=${mitEmail} felder_ohne=${ohne}`);
    if (mitEmail !== "abgewiesen") fehler.push("CHECK import_zeile_felder_check laesst einen Personen-Schluessel durch");
    if (ohne !== "angenommen") fehler.push("CHECK import_zeile_felder_check weist eine Zeile ohne Personen-Schluessel ab");
  }

  await sql.end();
  if (fehler.length) {
    console.error("::error::IMPORTCHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("IMPORTCHECK OK");
}

main().catch(async (err) => {
  console.error("::error::IMPORTCHECK abgebrochen: " + (err instanceof Error ? err.message : String(err)));
  await sql.end();
  process.exit(1);
});
