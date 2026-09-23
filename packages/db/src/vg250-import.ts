/**
 * F0b PR B: VG250-Import, SQL-Teil (nach dem ogr2ogr-Staging im Workflow
 * import-vg250.yml). Liest die Staging-Tabellen vg250_import_lan und
 * vg250_import_krs (EPSG:4326, nur GF=4-Landflaechen, Spalten ars/gen/bez)
 * und ersetzt den Bestand in `verwaltungsgebiet` in EINER Transaktion —
 * ganz oder gar nicht. Sollwerte aus der BKG-Lieferung zum Stichtag
 * 01.01.2026 (verwaltungsgliederung/vgtb_att_vg): 16 Laender, 401 Kreise
 * (Hanau ist zum 01.01.2026 kreisfrei geworden — daher 401, nicht 400).
 * Jede Abweichung bricht LAUT ab, es wird nichts ersetzt.
 *
 * geom_anzeige: ST_SimplifyPreserveTopology mit Toleranz 0.001 Grad
 * (~70-110 m) — unterhalb der Pixelaufloesung bei Zoom 10 (~150 m/px),
 * d. h. in karte. bei Zoom 8-10 keine sichtbare Abweichung, Datenvolumen
 * etwa eine Groessenordnung kleiner.
 */
import postgres from "postgres";

export const VG250_STICHTAG = "2026-01-01";
export const SOLL_LAENDER = 16;
export const SOLL_KREISE = 401;
const SIMPLIFY_TOLERANZ = 0.001;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const sql = postgres(url, { max: 1, fetch_types: false });

async function main() {
  const ziel = new URL(url!);
  console.log(`VG250ZIEL host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);

  // Vor-Checks auf dem Staging (ausserhalb der Ersetzung, rein lesend).
  const [vor] = await sql`
    select (select count(distinct ars)::int from vg250_import_lan) as laender,
           (select count(distinct ars)::int from vg250_import_krs) as kreise,
           (select count(*)::int from vg250_import_krs k
              where not exists (select 1 from vg250_import_lan l where l.ars = left(k.ars, 2))) as kreise_ohne_land,
           (select count(*)::int from vg250_import_lan where length(ars) <> 2) as laender_ars_falsch,
           (select count(*)::int from vg250_import_krs where length(ars) <> 5) as kreise_ars_falsch`;
  console.log("VG250STAGING " + JSON.stringify(vor));
  const fehler: string[] = [];
  if (vor!.laender !== SOLL_LAENDER) fehler.push(`${vor!.laender} Laender statt ${SOLL_LAENDER}`);
  if (vor!.kreise !== SOLL_KREISE) fehler.push(`${vor!.kreise} Kreise statt ${SOLL_KREISE}`);
  if (vor!.kreise_ohne_land) fehler.push(`${vor!.kreise_ohne_land} Kreis-ARS ohne Land-ARS-Praefix`);
  if (vor!.laender_ars_falsch) fehler.push(`${vor!.laender_ars_falsch} Land-ARS nicht 2-stellig`);
  if (vor!.kreise_ars_falsch) fehler.push(`${vor!.kreise_ars_falsch} Kreis-ARS nicht 5-stellig`);
  if (fehler.length) {
    console.error("::error::Abbruch, Bestand unangetastet: " + fehler.join(" · "));
    process.exit(1);
  }

  // Ersetzung: ganz oder gar nicht (eine Transaktion, Nach-Checks inklusive).
  await sql.begin(async (tx) => {
    await tx`DELETE FROM verwaltungsgebiet`;
    for (const [staging, ebene] of [
      ["vg250_import_lan", "land"],
      ["vg250_import_krs", "kreis"],
    ] as const) {
      // Doku: je Verwaltungseinheit genau EIN GF=4-Attributsatz — die
      // Gruppierung ist defensiv, falls eine Lieferung doch mehrere
      // Teilflaechen je ARS traegt (dann MultiPolygon-Union).
      await tx`INSERT INTO verwaltungsgebiet (ars, ebene, name, bez, geom, geom_anzeige, stichtag)
        SELECT ars,
               ${ebene}::verwaltungs_ebene,
               max(gen),
               max(bez),
               ST_Multi(ST_Union(geom)),
               ST_Multi(ST_SimplifyPreserveTopology(ST_Union(geom), ${SIMPLIFY_TOLERANZ})),
               ${VG250_STICHTAG}::date
        FROM ${tx(staging)}
        GROUP BY ars`;
    }
    const [nach] = await tx`
      select (select count(*)::int from verwaltungsgebiet where ebene = 'land') as laender,
             (select count(*)::int from verwaltungsgebiet where ebene = 'kreis') as kreise,
             (select count(*)::int from verwaltungsgebiet k
                where k.ebene = 'kreis'
                  and not exists (select 1 from verwaltungsgebiet l
                                    where l.ebene = 'land' and l.ars = left(k.ars, 2))) as kreise_ohne_land,
             (select count(*)::int from verwaltungsgebiet where NOT ST_IsValid(geom)) as ungueltige_geom`;
    console.log("VG250NACH " + JSON.stringify(nach));
    if (
      nach!.laender !== SOLL_LAENDER ||
      nach!.kreise !== SOLL_KREISE ||
      nach!.kreise_ohne_land !== 0 ||
      nach!.ungueltige_geom !== 0
    )
      throw new Error(
        `Nach-Check verletzt (${JSON.stringify(nach)}) — Transaktion wird zurueckgerollt, Bestand unangetastet.`,
      );
  });

  await sql`DROP TABLE IF EXISTS vg250_import_lan, vg250_import_krs`;
  console.log(
    `VG250-Import OK: ${SOLL_LAENDER} Laender + ${SOLL_KREISE} Kreise (Stichtag ${VG250_STICHTAG}) ersetzt, Staging entfernt.`,
  );
  await sql.end();
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
