/**
 * E68 PR 1: PLZ-Import, SQL-Teil (nach dem ogr2ogr-Staging im Workflow
 * import-plz.yml). Liest die Staging-Tabellen
 *   plz_import_gebiet  (plz, geom)        — OSM-PLZ-Gebiete, yetzt/postleitzahlen
 *   plz_import_gem     (ars, gen, geom)   — VG250-Gemeinden (GF=4), BKG
 * und ersetzt plz_gebiet und plz_ort in EINER Transaktion — ganz oder gar
 * nicht. Sollwert aus der Quelle (Release 2026.02, lokal gemessen 06.10.2026):
 * 8.175 verschiedene PLZ (8.176 Features, 75378 doppelt -> Union); VG250
 * 01.01.2026: 10.939 Gemeinden mit GF=4 (gemessen auf wegwerf, Lauf
 * 37542836467, 07.10.2026). Ergebnis dort: 13.058 Orte, 4 PLZ ohne Ort
 * (Exklaven), bis 39 Orte je PLZ, 48 MB + 62 MB, 60 s.
 *
 * Geometrie: ST_MakeValid je Feature VOR der Union (wegwerf 07.10.2026: die
 * rohen OSM-Flaechen enthalten Selbstueberschneidungen, GEOS bricht die Union
 * sonst mit TopologyException ab), ST_SimplifyPreserveTopology mit
 * SIMPLIFY_TOLERANZ, dann Rundung auf 1e-6 Grad. plz_ort traegt KEINE
 * Geometrie (Eric 07.10.2026, Speicher: Neon Free, 1 GB je Projekt): der
 * Schnitt PLZ x Gemeinde wird nur beim Import gerechnet — eine Gemeinde
 * gehoert zur PLZ, wenn der Schnitt >= 10 % der Gemeinde- ODER der PLZ-Flaeche
 * ist (Splitter aus Grenzabweichungen OSM/BKG fallen heraus).
 *
 * Umgebung: DATABASE_URL (Neon oder die Wegwerf-Postgres der CI). Mit
 * PLZ_SOLL_PRUEFEN=nein (nur Wegwerf-Fixture) entfallen die Sollwerte; mit
 * PLZ_MESSUNG=ja (wegwerf) wird die Vereinfachung gegen die Rohflaechen
 * gemessen: Groesse vorher/nachher und Anteil zufaelliger Punkte mit anderer
 * PLZ (PLZVERGLEICH).
 */
import postgres from "postgres";

export const PLZ_STICHTAG = "2026-02-20";
export const SOLL_PLZ = 8175;
export const SOLL_GEMEINDEN = 10_939;
/**
 * Vereinfachung 0,00015 Grad: ≈ 17 m in Nord-Sued, ≈ 11 m in Ost-West (bei 50°
 * Breite). Die OSM-PLZ-Grenzen sind selbst nur auf einige zehn Meter genau,
 * ein Pin aus der Adresspruefung liegt an der Hausnummer oder im Gebiet —
 * fuer „in welcher PLZ liegt der Punkt" aendert sich praktisch nichts, die
 * Tabelle schrumpft um den Grossteil der Stuetzpunkte. Gemessen im Wegwerf-
 * Lauf (PLZVERGLEICH), Entscheidung bei Eric.
 */
export const SIMPLIFY_TOLERANZ = 0.00015;
const RUNDUNG = 0.000001;
const MESSPUNKTE = 20_000;
const ANTEIL_MIN = 0.1;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sollPruefen = process.env.PLZ_SOLL_PRUEFEN !== "nein";
const messung = process.env.PLZ_MESSUNG === "ja";
const sql = postgres(url, { max: 1, fetch_types: false });

async function main() {
  const ziel = new URL(url!);
  console.log(`PLZZIEL host=${ziel.hostname} db=${ziel.pathname.slice(1)} soll=${sollPruefen ? "ja" : "nein"}`);

  const geomSpalte = async (tabelle: string) => {
    const [r] = await sql`select f_geometry_column as spalte from geometry_columns where f_table_name = ${tabelle} limit 1`;
    if (!r) throw new Error(`Staging-Tabelle ${tabelle} hat keine Geometriespalte (ogr2ogr-Schritt pruefen).`);
    return r.spalte as string;
  };
  const geomPlz = await geomSpalte("plz_import_gebiet");
  const geomGem = await geomSpalte("plz_import_gem");
  console.log(`PLZSPALTEN gebiet=${geomPlz} gem=${geomGem}`);

  const [vor] = await sql`
    select (select count(distinct plz)::int from plz_import_gebiet) as plz,
           (select count(*)::int from plz_import_gebiet where plz !~ '^[0-9]{5}$') as plz_falsch,
           (select count(*)::int from plz_import_gem) as gemeinden,
           (select count(*)::int from plz_import_gem where length(ars) <> 12) as gem_ars_falsch`;
  console.log("PLZSTAGING " + JSON.stringify(vor));
  const fehler: string[] = [];
  if (vor!.plz_falsch) fehler.push(`${vor!.plz_falsch} PLZ nicht 5-stellig`);
  if (vor!.gem_ars_falsch) fehler.push(`${vor!.gem_ars_falsch} Gemeinde-ARS nicht 12-stellig`);
  if (sollPruefen) {
    if (vor!.plz !== SOLL_PLZ) fehler.push(`${vor!.plz} PLZ statt ${SOLL_PLZ}`);
    if (vor!.gemeinden !== SOLL_GEMEINDEN) fehler.push(`${vor!.gemeinden} Gemeinden statt ${SOLL_GEMEINDEN}`);
  }
  if (fehler.length) {
    console.error("::error::Abbruch, Bestand unangetastet: " + fehler.join(" · "));
    process.exit(1);
  }

  const t0 = Date.now();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM plz_ort`;
    await tx`DELETE FROM plz_gebiet`;
    // Rohe Union je PLZ (bereinigt, nur gerundet) — Grundlage fuer Schnitt und Messung.
    await tx`CREATE TEMP TABLE plz_roh ON COMMIT DROP AS
      SELECT plz,
             ST_Multi(ST_ReducePrecision(ST_MakeValid(ST_Union(ST_MakeValid(${tx(geomPlz)}))), ${RUNDUNG}))::geometry(MultiPolygon,4326) AS geom
      FROM plz_import_gebiet GROUP BY plz`;
    await tx`CREATE INDEX ON plz_roh USING GIST (geom)`;
    // Vereinfachte Gebiete fuer den Bestand.
    await tx`CREATE TEMP TABLE plz_tmp ON COMMIT DROP AS
      SELECT plz,
             ST_Multi(ST_ReducePrecision(
               ST_MakeValid(ST_SimplifyPreserveTopology(geom, ${SIMPLIFY_TOLERANZ})),
               ${RUNDUNG}))::geometry(MultiPolygon,4326) AS geom
      FROM plz_roh`;
    await tx`CREATE TEMP TABLE gem_tmp ON COMMIT DROP AS
      SELECT ars, max(gen) AS gen,
             ST_Multi(ST_ReducePrecision(
               ST_SimplifyPreserveTopology(ST_MakeValid(ST_Union(ST_MakeValid(${tx(geomGem)}))), ${SIMPLIFY_TOLERANZ}),
               ${RUNDUNG}))::geometry(MultiPolygon,4326) AS geom
      FROM plz_import_gem GROUP BY ars`;
    await tx`CREATE INDEX ON plz_tmp USING GIST (geom)`;
    await tx`CREATE INDEX ON gem_tmp USING GIST (geom)`;

    await tx`INSERT INTO plz_gebiet (plz, geom, stichtag)
      SELECT plz, geom, ${PLZ_STICHTAG}::date FROM plz_tmp`;

    // Schnitt PLZ (roh) x Gemeinde nur fuer die Zuordnung; Flaechenanteile in
    // Grad^2 (relativ, daher ohne Projektion). Die Schnittflaeche wird nicht gespeichert.
    await tx`INSERT INTO plz_ort (plz, ort, ort_norm, ars)
      SELECT s.plz, s.gen, plz_ort_norm(s.gen), s.ars
      FROM (
        SELECT p.plz, g.ars, g.gen,
               ST_Area(ST_CollectionExtract(ST_Intersection(p.geom, g.geom), 3)) AS a_schnitt,
               ST_Area(p.geom) AS a_plz, ST_Area(g.geom) AS a_gem
        FROM plz_roh p JOIN gem_tmp g ON ST_Intersects(p.geom, g.geom)
      ) s
      WHERE s.a_schnitt > 0
        AND (s.a_schnitt >= ${ANTEIL_MIN} * s.a_gem OR s.a_schnitt >= ${ANTEIL_MIN} * s.a_plz)`;

    if (messung) {
      // Vereinfachung gegen Rohflaechen: zufaellige Punkte im Rahmen der
      // Rohflaechen, die in mindestens einer Rohflaeche liegen; abweichend =
      // andere (oder keine) PLZ nach ST_Covers auf der vereinfachten Flaeche.
      const [v] = await tx`
        with rahmen as (select ST_Extent(geom)::geometry as b from plz_roh),
             punkte as (
               select (ST_Dump(ST_GeneratePoints(b, ${MESSPUNKTE}, 42))).geom as p from rahmen
             ),
             roh as (
               select p, (select r.plz from plz_roh r where ST_Covers(r.geom, p) order by ST_Area(r.geom) limit 1) as plz from punkte
             ),
             beide as (
               select plz as plz_roh,
                      (select t.plz from plz_tmp t where ST_Covers(t.geom, p) order by ST_Area(t.geom) limit 1) as plz_neu
               from roh where plz is not null
             )
        select count(*)::int as punkte,
               count(*) filter (where plz_roh is distinct from plz_neu)::int as abweichend,
               count(*) filter (where plz_neu is null)::int as ohne_plz_neu,
               pg_size_pretty(sum(pg_column_size(r.geom))::bigint) as geom_roh,
               (select pg_size_pretty(sum(pg_column_size(geom))::bigint) from plz_tmp) as geom_neu,
               (select sum(ST_NPoints(geom))::bigint from plz_roh) as punkte_roh,
               (select sum(ST_NPoints(geom))::bigint from plz_tmp) as punkte_neu
        from beide, plz_roh r
        group by ()`;
      console.log("PLZVERGLEICH " + JSON.stringify({ toleranz_grad: SIMPLIFY_TOLERANZ, ...v }));
    }

    const [nach] = await tx`
      select (select count(*)::int from plz_gebiet) as plz,
             (select count(*)::int from plz_ort) as orte,
             (select count(*)::int from plz_gebiet g where not exists (select 1 from plz_ort o where o.plz = g.plz)) as plz_ohne_ort,
             (select count(*)::int from plz_gebiet where NOT ST_IsValid(geom)) as ungueltig_gebiet,
             (select max(n)::int from (select count(*) n from plz_ort group by plz) x) as max_orte_je_plz,
             pg_size_pretty(pg_total_relation_size('plz_gebiet')) as groesse_gebiet,
             pg_size_pretty(pg_total_relation_size('plz_ort')) as groesse_ort,
             pg_size_pretty(pg_total_relation_size('plz_gebiet') + pg_total_relation_size('plz_ort')) as groesse_gesamt,
             pg_size_pretty(pg_database_size(current_database())) as groesse_db`;
    console.log("PLZNACH " + JSON.stringify(nach));
    const nachFehler: string[] = [];
    if (sollPruefen && nach!.plz !== SOLL_PLZ) nachFehler.push(`${nach!.plz} PLZ statt ${SOLL_PLZ}`);
    if (nach!.ungueltig_gebiet) nachFehler.push("ungueltige Geometrien");
    if (nach!.plz_ohne_ort > 0) {
      // Erwartet fuer Exklaven ausserhalb Deutschlands (oesterreichische 87491, 87567-69, Buesingen 78266):
      // melden, nicht abbrechen — der Schwellwert steht im Protokoll.
      console.log(`PLZHINWEIS ${nach!.plz_ohne_ort} PLZ ohne Ort (Schnitt unter ${ANTEIL_MIN * 100} %, z. B. Exklaven)`);
    }
    if (nachFehler.length) throw new Error(`Nach-Check verletzt (${nachFehler.join(" · ")}) — Transaktion wird zurueckgerollt, Bestand unangetastet.`);
  });

  await sql`DROP TABLE IF EXISTS plz_import_gebiet, plz_import_gem`;
  console.log(`PLZ-Import OK in ${((Date.now() - t0) / 1000).toFixed(1)} s (Stichtag ${PLZ_STICHTAG}), Staging entfernt.`);
  await sql.end();
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
