/**
 * E68 PR 1: Check der lokalen Adresspruefung — gegen die Wegwerf-Postgres der
 * CI (nach Migration und Fixture-Import) oder gegen eine echte Datenbank mit
 * Bestand. Zwei Teile:
 *
 *  A) Paritaet SQL <-> TS: plz_ort_norm / plz_ort_passt (Migration 0047)
 *     muessen auf den gemeinsamen Faellen aus src/plz.ts dasselbe liefern wie
 *     normalisiereOrt / ortPasst. Eine Regel, zwei Laufzeiten.
 *  B) Funktionen am Bestand (nur, wenn plz_gebiet gefuellt ist; mit
 *     PLZ_FIXTURE=ja gegen die synthetischen Werte der Fixture):
 *     - plz_pruefung: bekannte/unbekannte PLZ, passender Ort, Kurzform,
 *       falscher Ort -> Vorschlaege (Rot: unbekannte PLZ wird abgewiesen,
 *       falscher Ort liefert die richtigen Orte)
 *     - plz_fuer_punkt: PLZ und Ort zum Pin, Grenzpunkt genau eine erste Zeile
 *     - punkt_in_plz: innen true, aussen false, unbekannte PLZ null
 *     - Fixture: 75378 ist EINE Zeile (Union), Splitter-Gemeinde fehlt,
 *       Groß Köris steht an zwei PLZ.
 */
import postgres from "postgres";

import { ORT_NORM_FAELLE, ORT_PASST_FAELLE, normalisiereOrt, ortPasst } from "./plz";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(2);
}
const fixture = process.env.PLZ_FIXTURE === "ja";
const sql = postgres(url, { max: 1, fetch_types: false });
const fehler: string[] = [];
/** postgres-js ohne fetch_types liefert text[] als Text („{a,b}") — deshalb array_to_json(...)::text und JSON.parse. */
const pruefung = async (plz: string, ort: string | null) => {
  const [r] = await sql`select plz_bekannt, ort_passt, array_to_json(orte)::text as orte_json from plz_pruefung(${plz}, ${ort})`;
  return { plz_bekannt: r!.plz_bekannt as boolean, ort_passt: r!.ort_passt as boolean, orte: JSON.parse(r!.orte_json as string) as string[] };
};
const pruefe = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "OK " : "ROT"} ${name}${detail === undefined ? "" : ": " + JSON.stringify(detail)}`);
  if (!ok) fehler.push(name);
};

async function main() {
  const ziel = new URL(url!);
  console.log(`PLZCHECK host=${ziel.hostname} db=${ziel.pathname.slice(1)} fixture=${fixture ? "ja" : "nein"}`);

  // A) Paritaet
  for (const [eingabe, erwartet] of ORT_NORM_FAELLE) {
    const [r] = await sql`select plz_ort_norm(${eingabe}) as n`;
    pruefe(`norm „${eingabe}“`, r!.n === erwartet && normalisiereOrt(eingabe) === erwartet, { sql: r!.n, ts: normalisiereOrt(eingabe) });
  }
  for (const [eingabe, ortNorm, erwartet] of ORT_PASST_FAELLE) {
    const [r] = await sql`select plz_ort_passt(${eingabe}, ${ortNorm}) as p`;
    pruefe(`passt „${eingabe}“ zu „${ortNorm}“`, r!.p === erwartet && ortPasst(eingabe, ortNorm) === erwartet, { sql: r!.p, ts: ortPasst(eingabe, ortNorm) });
  }

  // B) Bestand
  const [{ n }] = await sql`select count(*)::int as n from plz_gebiet`;
  if (n === 0) {
    console.log("PLZBESTAND leer — Funktions-Checks uebersprungen (Import noch nicht gelaufen).");
  } else {
    const [{ plz, ort }] = fixture
      ? [{ plz: "11111", ort: "Altstadt" }]
      : ((await sql`select plz, ort from plz_ort order by plz, ort limit 1`) as unknown as { plz: string; ort: string }[]);
    const bekannt = await pruefung(plz, ort);
    pruefe("plz_pruefung: bekannte PLZ, passender Ort", bekannt.plz_bekannt === true && bekannt.ort_passt === true && bekannt.orte.includes(ort), bekannt);
    const falsch = await pruefung(plz, 'Xyzzy');
    pruefe("Rot: falscher Ort passt nicht, Vorschlaege sind die Orte der PLZ", falsch.plz_bekannt === true && falsch.ort_passt === false && falsch.orte.length >= 1, falsch);
    const unbekannt = await pruefung('00000', ort);
    pruefe("Rot: unbekannte PLZ wird abgewiesen (plz_bekannt false, keine Orte)", unbekannt.plz_bekannt === false && unbekannt.ort_passt === false && unbekannt.orte.length === 0, unbekannt);
    const nullOrt = await pruefung(plz, null);
    pruefe("plz_pruefung: ohne Ort nur PLZ-Existenz", nullOrt.plz_bekannt === true && nullOrt.ort_passt === false, nullOrt);

    // Punkt im Inneren des PLZ-Gebiets
    const [innen] = await sql`select ST_AsText(ST_PointOnSurface(geom)) as p from plz_gebiet where plz = ${plz}`;
    const treffer = (await sql`select plz, array_to_json(orte)::text as orte_json from plz_fuer_punkt(ST_GeomFromText(${innen!.p}, 4326))`) as unknown as { plz: string; orte_json: string }[];
    pruefe("plz_fuer_punkt: Punkt in der Flaeche liefert PLZ und ihre Orte", treffer.length >= 1 && treffer[0]!.plz === plz && (JSON.parse(treffer[0]!.orte_json) as string[]).includes(ort), { punkt: innen!.p, treffer: treffer.slice(0, 2) });
    const [drin] = await sql`select punkt_in_plz(${plz}, ST_GeomFromText(${innen!.p}, 4326)) as d`;
    pruefe("punkt_in_plz: innen true", drin!.d === true);
    const [draussen] = await sql`select punkt_in_plz(${plz}, ST_SetSRID(ST_MakePoint(0, 0), 4326)) as d`;
    pruefe("punkt_in_plz: Punkt im Atlantik false", draussen!.d === false);
    const [unbek] = await sql`select punkt_in_plz('00000', ST_GeomFromText(${innen!.p}, 4326)) as d`;
    pruefe("punkt_in_plz: unbekannte PLZ -> null", unbek!.d === null);
    const nirgends = await sql`select * from plz_fuer_punkt(ST_SetSRID(ST_MakePoint(0, 0), 4326))`;
    pruefe("plz_fuer_punkt: Punkt ausserhalb -> keine Zeile", nirgends.length === 0);

    if (fixture) {
      const kurz = await pruefung('11111', 'Gross');
      pruefe("Fixture: Kurzform „Gross“ passt zu „Groß Köris“", kurz.ort_passt === true, kurz);
      const [zweiPlz] = await sql`select count(*)::int as n from plz_ort where ort = 'Groß Köris'`;
      pruefe("Fixture: Groß Köris steht an zwei PLZ (je 50 % der Gemeinde)", zweiPlz!.n === 2, zweiPlz);
      const [splitter] = await sql`select count(*)::int as n from plz_ort where ort = 'Splitter'`;
      pruefe("Fixture: Splitter (1 % Schnitt) faellt heraus", splitter!.n === 0, splitter);
      const [union] = await sql`select count(*)::int as n, (select ST_NumGeometries(geom) from plz_gebiet where plz = '75378') as teile from plz_gebiet where plz = '75378'`;
      pruefe("Fixture: 75378 doppelt in der Quelle -> eine PLZ (Union)", union!.n === 1 && Number(union!.teile) >= 1, union);
      const grenze = await sql`select plz from plz_fuer_punkt(ST_SetSRID(ST_MakePoint(8.10, 49.05), 4326))`;
      pruefe("Fixture: Grenzpunkt 8,10 trifft beide Seiten, erste Zeile deterministisch", grenze.length === 2 && grenze[0]!.plz === "11111", grenze);
      const [pforzheim] = await sql`select plz, array_to_json(orte)::text as orte_json from plz_fuer_punkt(ST_SetSRID(ST_MakePoint(8.37, 49.02), 4326))`;
      pruefe("Fixture: Punkt im zweiten Teil von 75378 -> PLZ 75378 mit Ort Pforzheim", pforzheim?.plz === "75378" && (JSON.parse(pforzheim!.orte_json as string) as string[]).includes("Pforzheim"), pforzheim);
      const [tabelle] = await sql`select count(*)::int as n from information_schema.columns where table_name = 'plz_ort' and column_name = 'geom'`;
      pruefe("Fixture: plz_ort traegt keine Geometrie", tabelle!.n === 0, tabelle);
    }
  }

  await sql.end();
  if (fehler.length) {
    console.error(`::error::PLZ-CHECK VERLETZT: ${fehler.join(" · ")}`);
    process.exit(1);
  }
  console.log("PLZ-CHECK OK");
}

void main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
