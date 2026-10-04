/**
 * E34: dauerhafter DB-Check der Beleg-Zusicherungen — laeuft im Deploy-CI
 * bei jedem PR gegen die echte Preview-DB (wie Sektor- und Belegnummer-Check).
 *
 * 1. Das Enum kennt genau die sieben Typen; `dokument_link` gibt es nicht mehr.
 * 2. Der CHECK auf die Quellenangabe GREIFT: fehlend, leer und reiner
 *    Leerraum werden abgewiesen (nicht nur behauptet).
 * 3. E21-Nachweis fuer JEDEN Schreibpfad auf `beleg` (Suche 26.09.2026:
 *    `insert(beleg)`/`update(beleg)` in apps/web/lib/beleg-server.ts,
 *    `INSERT INTO beleg` in apps/web/scripts/seed-preview.ts): fuer alle
 *    sieben Typen ein INSERT in der Spaltenform des Formulars und ein
 *    INSERT in der Spaltenform des Seeds, dazu das UPDATE-Muster des
 *    Formulars — jeweils in einer zurueckgerollten Transaktion. Dabei muss
 *    die GENERATED-Stufe der E34-Matrix entsprechen.
 * 4. Kein Beleg ohne Quellenangabe im Bestand (der CHECK haelt es, der
 *    Zaehler zeigt es).
 *
 * Schreibt nichts Bleibendes: alle Schreibfaelle werden zurueckgerollt.
 */
import postgres from "postgres";

import { journalModus, modusText, zaehlerPasst } from "./journal-vergleich";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

const TYPEN = [
  "dokument",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
  "betriebsdaten",
  "webrecherche",
];

/** E34-Matrix: erwartete Stufe [mit Datei, ohne Datei und Link]. */
const MATRIX: Record<string, [string, string]> = {
  betriebsdaten: ["A", "B"],
  vertrag: ["A", "B"],
  absichtserklaerung: ["B", "C"],
  angebot: ["B", "C"],
  gespraech: ["C", "C"],
  dokument: ["C", "D"],
  webrecherche: ["D", "D"],
};

const ROLLBACK = Symbol("rollback");

/** Fuehrt fn in einer Transaktion aus und rollt sie IMMER zurueck. */
async function probe(fn: (tx: postgres.TransactionSql) => Promise<void>): Promise<string | null> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
    return null;
  } catch (e) {
    if (e === ROLLBACK) return null;
    return e instanceof Error ? e.message.split("\n")[0]! : String(e);
  }
}

async function main() {
  const ziel = new URL(url!);
  console.log(`BELEGCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  // (1) Enum-Werte
  const werte = (
    await sql`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
              where t.typname = 'beleg_typ' order by e.enumsortorder`
  ).map((r) => r.enumlabel as string);
  console.log("ENUM " + JSON.stringify(werte));
  for (const t of TYPEN) if (!werte.includes(t)) fehler.push(`Enum-Wert ${t} fehlt`);
  if (werte.includes("dokument_link")) fehler.push("dokument_link existiert noch im Enum");
  {
    // Journal-Vergleich (Eric 01.10.2026): exakt bei gleichem Journal, mindestens wenn die DB voraus ist.
    const journal = await journalModus(sql, url!);
    console.log(modusText(journal));
    if (journal.modus === "rot") fehler.push(journal.grund);
    const z = zaehlerPasst("Enum-Werte", werte.length, TYPEN.length, journal.modus === "mindest" ? "mindest" : "exakt");
    if (z) fehler.push(z);
  }

  // (2) CHECK greift — drei Arten von "keine Quellenangabe".
  for (const [fall, metadata] of [
    ["fehlt", {}],
    ["leer", { quellenangabe: "" }],
    ["Leerraum", { quellenangabe: "   " }],
  ] as const) {
    // Typ gespraech: braucht kein gueltig_bis (E33, 0022) — so trifft die
    // Probe garantiert den Quellenangabe-CHECK und nicht den Fristen-CHECK.
    const grund = await probe(async (tx) => {
      await tx`insert into beleg (typ, metadata) values ('gespraech', ${tx.json(metadata as never)})`;
    });
    const abgewiesen = grund !== null && grund.includes("beleg_quellenangabe_check");
    console.log(`CHECK_QUELLE ${fall} abgewiesen=${abgewiesen}${grund ? ` grund="${grund}"` : ""}`);
    if (!abgewiesen) fehler.push(`Quellenangabe "${fall}" wurde NICHT vom CHECK abgewiesen`);
  }

  // (3) Schreibpfade: Formular (erstelleBeleg) und Seed (seed-preview.ts),
  // je Typ, mit Datei und ohne — die Stufe muss der Matrix folgen.
  for (const typ of TYPEN) {
    const gueltigBis = ["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"].includes(typ)
      ? "2027-12-31"
      : null;
    for (const mitDatei of [true, false]) {
      const erwartet = MATRIX[typ]![mitDatei ? 0 : 1];
      // Formular-Pfad: Spalten wie apps/web/lib/beleg-server.ts::erstelleBeleg,
      // danach das UPDATE-Muster von aktualisiereBeleg auf derselben Zeile.
      const grund = await probe(async (tx) => {
        const [row] = await tx`insert into beleg
            (typ, datei_key, link_url, extern_nachvollziehbar, metadata, gueltig_bis, erstellt_am)
          values (${typ}::beleg_typ, ${mitDatei ? "belege/preview/check.pdf" : null}, ${null},
                  false, ${tx.json({ quellenangabe: "Beleg-Check E34" })}, ${gueltigBis}, now())
          returning id, qualitaet::text as stufe`;
        if (row!.stufe !== erwartet)
          throw new Error(`Formular-Insert ${typ} mitDatei=${mitDatei}: Stufe ${row!.stufe} statt ${erwartet}`);
        const [upd] = await tx`update beleg set
            typ = ${typ}::beleg_typ, datei_key = ${mitDatei ? "belege/preview/check.pdf" : null},
            link_url = ${null}, extern_nachvollziehbar = true,
            metadata = ${tx.json({ quellenangabe: "Beleg-Check E34 (geaendert)" })},
            gueltig_bis = ${gueltigBis}, erstellt_am = now()
          where id = ${row!.id} returning qualitaet::text as stufe`;
        if (upd!.stufe !== erwartet)
          throw new Error(`Formular-Update ${typ} mitDatei=${mitDatei}: Stufe ${upd!.stufe} statt ${erwartet}`);
      });
      if (grund) fehler.push(grund);
      // Seed-Pfad: Spalten wie apps/web/scripts/seed-preview.ts (Link statt Datei).
      // Ein Link ist nur dort Nachweis, wo "Datei oder Link" gilt.
      const seedErwartet =
        MATRIX[typ]![mitDatei && ["betriebsdaten", "angebot", "dokument"].includes(typ) ? 0 : 1];
      const grundSeed = await probe(async (tx) => {
        const [row] = await tx`insert into beleg
            (typ, extern_nachvollziehbar, link_url, gueltig_bis, metadata, erstellt_am)
          values (${typ}::beleg_typ, true, ${mitDatei ? "https://seed.invalid/beleg/check" : null}, ${gueltigBis},
                  ${tx.json({ seed: "BELEG-CHECK", quellenangabe: "Synthetischer Seed-Beleg (Check)" })},
                  '2026-01-01T09:00:00Z')
          returning qualitaet::text as stufe`;
        if (row!.stufe !== seedErwartet)
          throw new Error(`Seed-Insert ${typ} mitLink=${mitDatei}: Stufe ${row!.stufe} statt ${seedErwartet}`);
      });
      if (grundSeed) fehler.push(grundSeed);
    }
  }
  console.log(`SCHREIBPFADE ${TYPEN.length} Typen × (Formular-Insert, Formular-Update, Seed-Insert) × (mit/ohne Nachweis) geprueft`);

  // (3b) Restore-Faehigkeit (Migration 0023): qualitaetsstufe() traegt einen
  // festen search_path — sonst scheitert pg_restore beim Anlegen der
  // Generated-Spalte an "type qualitaets_stufe does not exist" (28.09.2026).
  const [fn] = await sql`
    select array_to_string(p.proconfig, ' ') as config
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'qualitaetsstufe'`;
  const config = (fn?.config as string | null) ?? "";
  console.log(`FUNKTION_SEARCH_PATH ${JSON.stringify(config)}`);
  if (!/search_path=public/.test(config)) fehler.push("qualitaetsstufe() hat keinen festen search_path — Backup waere nicht zurueckspielbar");

  // (4) Bestand
  const [z] = await sql`
    select count(*)::int as belege,
           count(*) filter (where btrim(coalesce(metadata->>'quellenangabe', '')) = '')::int as ohne_quelle
      from beleg`;
  console.log("BESTAND " + JSON.stringify(z));
  if (z!.ohne_quelle) fehler.push(`${z!.ohne_quelle} Belege ohne Quellenangabe im Bestand`);

  await sql.end();
  if (fehler.length) {
    console.error("::error::BELEG-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Beleg-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
