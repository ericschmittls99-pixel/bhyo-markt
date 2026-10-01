// E23/E34/E62: Paritaetstest DB-Funktion qualitaetsstufe() (Migration 0032, vier Parameter)
// gegen deriveQualitaet — ueber alle Ankerfaelle, gegen die ECHTE Datenbank
// (DATABASE_URL), nicht gegen einen Mock. Laeuft im Deploy-CI direkt nach
// "Migrate Preview-DB"; eine Abweichung bricht den Deploy laut ab.
import { createSql } from "@bhyo/db/client";

import { ANKERFAELLE } from "../lib/qualitaet-ankerfaelle";
import { deriveQualitaet } from "../lib/qualitaet";

const sql = createSql(process.env.DATABASE_URL!);

// Seit E34 hat die Funktion nur noch (typ, datei_key, link_url) — metadata
// und erstellt_am sind keine Stufenbedingungen mehr. Die Treiber-Falle mit
// jsonb-Parametern (sql.json, 23.09.2026) betrifft diesen Aufruf damit
// nicht mehr; sie bleibt in seed-preview.ts dokumentiert.

async function main() {
  const fehler: string[] = [];
  for (const a of ANKERFAELLE) {
    const b = a.bewertung;
    const [row] = await sql`
      select qualitaetsstufe(
        ${b.typ}::beleg_typ,
        ${b.dateiKey ?? null},
        ${b.linkUrl ?? null},
        ${b.abgelaufenAm ?? null}::date
      )::text as stufe`;
    const db = row!.stufe as string;
    const ts = deriveQualitaet(b);
    if (db !== a.erwartet || ts !== a.erwartet)
      fehler.push(`${a.name}: erwartet ${a.erwartet}, DB ${db}, TS ${ts}`);
  }
  await sql.end();
  if (fehler.length) {
    console.error("PARITAET VERLETZT:\n" + fehler.join("\n"));
    process.exit(1);
  }
  console.log(`Paritaet OK: ${ANKERFAELLE.length} Ankerfaelle, DB == TS == erwartet.`);
}
void main();
