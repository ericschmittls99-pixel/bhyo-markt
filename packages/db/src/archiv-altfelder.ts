/**
 * Archiv-Waechter fuer Migration 0017 (F0b PR D, Spezifikation Eric):
 * UNMITTELBAR vor dem DROP der vier E7-Altspalten (landkreis/bundesland auf
 * beiden Stromtabellen) werden ALLE befuellten manuellen Werte (Strom-ID,
 * Art, Werte, Zeitstempel) archiviert — ins Job-Log UND als Datei
 * `altfelder-archiv.json` (der Workflow laedt sie als Workflow-Artefakt
 * hoch). Danach wird geprueft, dass die Zeilenzahl der geschriebenen Datei
 * exakt der SQL-Zaehlung entspricht; fehlt die Datei oder stimmt die Zahl
 * nicht: Abbruch OHNE DROP. Der Waechter laeuft auch bei 0 Zeilen (leeres
 * Artefakt, Zaehlung 0). Anders als der Vor-DROP-Waechter von 0014 (der
 * leere Spalten verlangte) DARF hier Inhalt existieren — er wird gesichert,
 * nicht blockiert.
 *
 * Defensiv: Existieren die Spalten nicht mehr (0017 bereits angewendet),
 * entfaellt die Archivierung mit Hinweis — der Step kann dauerhaft in den
 * Workflows stehen bleiben.
 */
import { writeFileSync, readFileSync } from "node:fs";

import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });
const DATEI = "altfelder-archiv.json";

async function main() {
  const ziel = new URL(url!);
  console.log(`ARCHIVZIEL host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);

  const spalten = await sql`
    select table_name from information_schema.columns
    where table_name in ('biomassestrom', 'output_bedarf') and column_name = 'landkreis'`;
  if (spalten.length === 0) {
    console.log("Altspalten existieren nicht (0017 bereits angewendet) — Archivierung entfaellt.");
    // Leere Datei schreiben, damit der nachfolgende Existenz-Check im
    // Workflow nie versehentlich einen Skip als Fehler wertet.
    writeFileSync(DATEI, JSON.stringify({ zeitpunkt: new Date().toISOString(), uebersprungen: true, zeilen: [] }, null, 1));
    await sql.end();
    return;
  }

  const zeilen = await sql`
    select id as strom_id, 'biomasse' as art, landkreis, bundesland, updated_at
    from biomassestrom where landkreis is not null or bundesland is not null
    union all
    select id, 'output', landkreis, bundesland, updated_at
    from output_bedarf where landkreis is not null or bundesland is not null
    order by art, strom_id`;
  const [zaehlung] = await sql`
    select (select count(*)::int from biomassestrom where landkreis is not null or bundesland is not null)
         + (select count(*)::int from output_bedarf where landkreis is not null or bundesland is not null) as n`;

  writeFileSync(
    DATEI,
    JSON.stringify({ zeitpunkt: new Date().toISOString(), host: ziel.hostname, zeilen }, null, 1),
  );
  for (const z of zeilen) console.log("ARCHIV " + JSON.stringify(z));

  const zurueck = JSON.parse(readFileSync(DATEI, "utf8")) as { zeilen: unknown[] };
  console.log(`ARCHIVSUMME datei=${zurueck.zeilen.length} zaehlung=${zaehlung!.n}`);
  await sql.end();
  if (zurueck.zeilen.length !== zaehlung!.n) {
    console.error(
      `::error::Abbruch OHNE DROP: Archivdatei traegt ${zurueck.zeilen.length} Zeilen, die Zaehlung sagt ${zaehlung!.n}.`,
    );
    process.exit(1);
  }
  console.log(`Archiv-Waechter OK: ${zaehlung!.n} Zeilen gesichert (auch 0 ist ein gueltiges Ergebnis) — DROP darf laufen.`);
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
