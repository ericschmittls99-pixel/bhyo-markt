/**
 * F0b (Review Eric, 23.09.2026): dauerhafte DB-Checks der raeumlichen
 * Verwaltungszuordnung — gegen die ECHTE Datenbank, nicht ueber den Seed.
 * Laeuft im Deploy-CI nach der Preview-Migration (wie der
 * Qualitaets-Paritaetstest); jede Verletzung bricht den Deploy ab.
 *
 * 1) Grenzpunkt: ein Stuetzpunkt direkt aus einer Kreisgeometrie liegt per
 *    ST_Covers in mindestens einem Gebiet (mit ST_Contains fiele er auf
 *    "ausserhalb") — und die DISTINCT-ON-Semantik liefert genau EINE Zeile,
 *    auch wenn der Punkt zwei angrenzende Gebiete trifft.
 * 2) Rheingrenze RP/BW: Kreis- und Land-ARS passen zusammen (Praefixregel),
 *    beidseits der Grenze.
 * 3) Eindeutigkeit der View: count(*) = count(DISTINCT strom_id).
 *
 * Solange verwaltungsgebiet leer ist (Import noch nicht gelaufen), werden
 * die Geometrie-Checks mit Hinweis uebersprungen — der Eindeutigkeits-Check
 * laeuft immer.
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
  console.log(`VERWCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);
  const fehler: string[] = [];

  const [n] = await sql`select count(*)::int as n from verwaltungsgebiet`;
  if (n!.n === 0) {
    console.log("verwaltungsgebiet ist leer (Import noch nicht gelaufen) — Geometrie-Checks entfallen.");
  } else {
    // 1) Stuetzpunkt exakt auf einer Kreisgrenze (erster Punkt des
    //    Aussenrings eines beliebigen Kreises).
    const [grenz] = await sql`
      with punkt as (
        select ST_PointN(ST_ExteriorRing(ST_GeometryN(geom, 1)), 1) as p, ars
        from verwaltungsgebiet where ebene = 'kreis' order by ars limit 1
      )
      select (select ars from punkt) as quelle_ars,
             (select count(*)::int from verwaltungsgebiet k, punkt
                where k.ebene = 'kreis' and ST_Covers(k.geom, punkt.p)) as covers_treffer,
             (select count(*)::int from (
                select distinct on (1) 1 from verwaltungsgebiet k, punkt
                where k.ebene = 'kreis' and ST_Covers(k.geom, punkt.p)
                order by 1, k.ars
              ) x) as zeilen_nach_distinct`;
    console.log("GRENZPUNKT " + JSON.stringify(grenz));
    if (grenz!.covers_treffer < 1)
      fehler.push("Grenz-Stuetzpunkt liegt in KEINEM Gebiet (ST_Covers-Semantik verletzt)");
    if (grenz!.zeilen_nach_distinct !== 1)
      fehler.push(`Grenz-Stuetzpunkt liefert ${grenz!.zeilen_nach_distinct} Zeilen statt genau 1`);

    // 2) Rheingrenze RP/BW: beidseits konsistente Kreis-/Land-ARS.
    for (const [name, lng, lat, kreisErwartet] of [
      ["RP-Seite", 8.45, 49.317, "07318"],
      ["BW-Seite", 8.455, 49.317, "08226"],
    ] as const) {
      const [r] = await sql`
        with z as (
          select k.ars from verwaltungsgebiet k
          where k.ebene = 'kreis'
            and ST_Covers(k.geom, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
          order by k.ars limit 1
        )
        select (select ars from z) as kreis_ars,
               (select count(*)::int from verwaltungsgebiet l, z
                  where l.ebene = 'land' and l.ars = left(z.ars, 2)) as land_passt`;
      console.log(`RHEIN ${name} ` + JSON.stringify(r));
      if (r!.kreis_ars !== kreisErwartet)
        fehler.push(`${name}: Kreis ${r!.kreis_ars} statt ${kreisErwartet}`);
      if (r!.land_passt !== 1)
        fehler.push(`${name}: Land-ARS-Praefix ohne Treffer auf ebene='land'`);
    }
  }

  // 3) Eindeutigkeit der View — immer.
  const [eind] = await sql`
    select count(*)::int as zeilen, count(distinct strom_id)::int as stroeme
    from strom_verwaltung`;
  console.log("EINDEUTIG " + JSON.stringify(eind));
  if (eind!.zeilen !== eind!.stroeme)
    fehler.push(`View nicht eindeutig: ${eind!.zeilen} Zeilen fuer ${eind!.stroeme} Stroeme`);

  await sql.end();
  if (fehler.length) {
    console.error("::error::VERWALTUNGS-CHECK VERLETZT: " + fehler.join(" · "));
    process.exit(1);
  }
  console.log("Verwaltungs-Check OK.");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(2);
});
