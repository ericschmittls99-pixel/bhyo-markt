// E23: Paritaetstest DB-Funktion qualitaetsstufe() (Migration 0013) gegen
// deriveQualitaet — ueber alle Ankerfaelle, gegen die ECHTE Datenbank
// (DATABASE_URL), nicht gegen einen Mock. Laeuft im Deploy-CI direkt nach
// "Migrate Preview-DB"; eine Abweichung bricht den Deploy laut ab.
import { createSql } from "@bhyo/db/client";

import { ANKERFAELLE } from "../lib/qualitaet-ankerfaelle";
import { deriveQualitaet } from "../lib/qualitaet";

const sql = createSql(process.env.DATABASE_URL!);

async function main() {
  const fehler: string[] = [];
  for (const a of ANKERFAELLE) {
    const b = a.bewertung;
    const [row] = await sql`
      select qualitaetsstufe(
        ${b.typ}::beleg_typ,
        ${b.externNachvollziehbar},
        ${b.dateiKey ?? null},
        ${b.linkUrl ?? null},
        ${b.gueltigBis ?? null}::date,
        ${JSON.stringify(b.metadata)}::jsonb,
        ${b.erhebungsdatum ?? null}::timestamptz
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
