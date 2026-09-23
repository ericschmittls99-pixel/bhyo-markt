/**
 * Vor-DROP-Waechter fuer Migration 0014 (Freigabe-Bedingung Eric,
 * 23.09.2026): UNMITTELBAR vor der Produktions-Migration muessen die
 * stillgelegten Stufenspalten leer sein — SELECT count(*) ... WHERE
 * qualitaet IS NOT NULL auf biomassestrom UND output_bedarf, beide 0,
 * sonst Abbruch OHNE DROP. Dazu der Zielnachweis (Host + Kontrollzaehlung
 * wie bei #57) im selben Job-Log. Nur lesend; migriert wird im Folge-Step.
 *
 * Defensiv gebaut: Existieren die Spalten nicht mehr (0014 bereits
 * angewendet, z. B. Preview), entfaellt die Zaehlung mit Hinweis — der
 * Step kann deshalb dauerhaft im Workflow stehen bleiben.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

async function main() {
  const ziel = new URL(url!);
  console.log(`ZIEL host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const [k] = await sql`
    select (select count(*)::int from materialart) as materialarten,
           (select count(*)::int from output_produkt) as produkte,
           (select count(*)::int from drizzle.__drizzle_migrations) as migrationen`;
  console.log("KONTROLLE " + JSON.stringify(k));
  if (!k!.materialarten || !k!.produkte || !k!.migrationen) {
    console.error("::error::Abbruch: Kontrollzaehlung 0 — Ziel-Datenbank unplausibel, es wurde nichts migriert.");
    process.exit(1);
  }

  const spalten = await sql`
    select table_name from information_schema.columns
    where table_name in ('biomassestrom', 'output_bedarf') and column_name = 'qualitaet'`;
  if (spalten.length === 0) {
    console.log("Stufenspalten existieren nicht (0014 bereits angewendet) — Vor-DROP-Zaehlung entfaellt.");
    await sql.end();
    return;
  }

  const [n] = await sql`
    select (select count(*)::int from biomassestrom where qualitaet is not null) as biomasse,
           (select count(*)::int from output_bedarf where qualitaet is not null) as output`;
  console.log("VOR_DROP " + JSON.stringify(n));
  if (n!.biomasse !== 0 || n!.output !== 0) {
    console.error(
      `::error::Abbruch OHNE DROP: stillgelegte Stufenspalten sind nicht leer (biomassestrom ${n!.biomasse}, output_bedarf ${n!.output}). Befund an Eric melden, nichts migrieren.`,
    );
    process.exit(1);
  }
  console.log("Vor-DROP-Zaehlung OK: beide Stufenspalten leer — DROP darf laufen.");
  await sql.end();
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
