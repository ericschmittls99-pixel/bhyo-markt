/**
 * E68 PR 1: Check der lokalen Adresspruefung — gegen die Wegwerf-Postgres der
 * CI (nach Migration und Fixture-Import) oder gegen eine echte Datenbank mit
 * Bestand. Zwei Teile:
 *
 *  A) Paritaet SQL <-> TS: plz_ort_norm / plz_ort_passt (Migration 0048)
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
 *     - plz_fuer_ort (E72, Migration 0051): eindeutiger Ort -> genau eine
 *       PLZ, Ort an zwei PLZ -> zwei Kandidaten, Kurzform und Ortsteil
 *       finden denselben Ort, unbekannter Ort -> keine Zeile; Paritaet zur
 *       Passt-Regel (dieselben Zeilen wie plz_ort_passt ueber plz_ort).
 *       Mit Bestand: Messung PLZMESSUNG_ORT (200 Orte in einer Abfrage).
 */
import postgres from "postgres";

import { ORT_NORM_FAELLE, ORT_PASST_FAELLE, ORT_PRAEFIX_FAELLE, normalisiereOrt, ortNormPraefixe, ortPasst } from "./plz";

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

  for (const [norm, erwartet] of ORT_PRAEFIX_FAELLE) {
    const [r] = await sql`select array_to_json(plz_ort_norm_praefixe(${norm}))::text as p`;
    const sqlWert = JSON.parse(r!.p as string) as string[];
    pruefe(`praefixe „${norm}“`, JSON.stringify(sqlWert) === JSON.stringify(erwartet) && JSON.stringify(ortNormPraefixe(norm)) === JSON.stringify(erwartet), { sql: sqlWert, ts: ortNormPraefixe(norm) });
  }
  const [idxMuster] = await sql`select count(*)::int as n from pg_indexes where tablename = 'plz_ort' and indexname = 'plz_ort_norm_muster_idx'`;
  pruefe("E72: Index plz_ort_norm_muster_idx (text_pattern_ops) vorhanden", idxMuster!.n === 1, idxMuster);

  // E72 (Eric 08.10.2026, 2b): Die Passt-Funktionen sind nicht mehr STRICT.
  // NULL- und Leerwerte muessen dasselbe liefern wie die STRICT-Fassung aus
  // 0048 — die steht hier woertlich als Sitzungsfunktion (pg_temp, nichts
  // bleibt in der DB) und wird ueber die ganze Matrix IS NOT DISTINCT FROM
  // verglichen; nur der gewollte Unterschied (Ortsteil) darf abweichen.
  await sql`CREATE FUNCTION pg_temp.plz_ort_passt_0048(p_eingabe text, p_ort_norm text) RETURNS boolean
    LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT plz_ort_norm(p_eingabe) <> ''
         AND (p_ort_norm = plz_ort_norm(p_eingabe)
              OR p_ort_norm LIKE replace(replace(plz_ort_norm(p_eingabe), '\\', '\\\\'), '%', '\\%') || ' %')
    $$`;
  const eingaben: (string | null)[] = [null, "", "   ", "Mannheim", "Mannheim-Neckarau", "Mannheimer Str.", "Ludwigshafen"];
  const ortNormen: (string | null)[] = [null, "", "mannheim", "mannheim neckarau", "ludwigshafen am rhein"];
  const abweichungen: string[] = [];
  const gewollt: string[] = [];
  for (const e of eingaben) {
    for (const o of ortNormen) {
      const [r] = await sql`select plz_ort_passt(${e}, ${o}) as neu, pg_temp.plz_ort_passt_0048(${e}, ${o}) as alt,
                                   (plz_ort_passt(${e}, ${o}) is not distinct from pg_temp.plz_ort_passt_0048(${e}, ${o})) as gleich`;
      if (!r!.gleich) {
        // Einziger gewollter Unterschied: Ortsteil-Toleranz (Eingabe beginnt mit dem Ort + Wortende), nie bei NULL/Leer.
        if (e && o && e.trim() && o.trim() && r!.neu === true && r!.alt === false) gewollt.push(`${e}|${o}`);
        else abweichungen.push(`${JSON.stringify(e)}|${JSON.stringify(o)}: neu=${r!.neu} alt=${r!.alt}`);
      }
    }
  }
  pruefe("E72 NULL/Leer wie 0048: plz_ort_passt liefert fuer NULL, '' und Leerraum dasselbe wie die STRICT-Fassung (35 Paare)", abweichungen.length === 0, abweichungen);
  pruefe("E72 gewollte Abweichung nur Ortsteil (Mannheim-Neckarau|mannheim)", JSON.stringify(gewollt) === JSON.stringify(["Mannheim-Neckarau|mannheim"]), gewollt);
  for (const [plz, ort] of [[null, null], ["", ""], ["00000", null], [null, "Mannheim"], ["", "Mannheim"]] as const) {
    const [r] = await sql`select plz_bekannt, ort_passt, array_to_json(orte)::text as orte_json from plz_pruefung(${plz}, ${ort})`;
    pruefe(`E72 NULL/Leer wie 0048: plz_pruefung(${JSON.stringify(plz)}, ${JSON.stringify(ort)}) -> unbekannt, passt nicht, keine Orte`, r!.plz_bekannt === false && r!.ort_passt === false && r!.orte_json === "[]", r);
  }
  const [fuerNull] = await sql`select (select count(*)::int from plz_fuer_ort(null)) as a, (select count(*)::int from plz_fuer_ort('')) as b, (select count(*)::int from plz_fuer_ort('  ')) as c`;
  pruefe("E72 NULL/Leer: plz_fuer_ort(NULL | '' | Leerraum) -> keine Kandidaten", fuerNull!.a === 0 && fuerNull!.b === 0 && fuerNull!.c === 0, fuerNull);

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

      // E72: PLZ aus Ort — Kandidaten je Eingabe.
      const fuerOrt = async (ort: string) => (await sql`select plz, ort, ars, kreis, land from plz_fuer_ort(${ort})`) as unknown as { plz: string; ort: string; ars: string; kreis: string | null; land: string | null }[];
      const eindeutig = await fuerOrt("Altstadt");
      pruefe("E72: eindeutiger Ort „Altstadt“ -> genau eine PLZ 11111", eindeutig.length === 1 && eindeutig[0]!.plz === "11111", eindeutig);
      const zwei = await fuerOrt("Groß Köris");
      pruefe("Rot: „Groß Köris“ liegt an zwei PLZ -> zwei Kandidaten, deterministisch sortiert", zwei.map((k) => k.plz).join(",") === "11111,22222", zwei);
      const kurzOrt = await fuerOrt("Gross");
      pruefe("E72: Kurzform „Gross“ findet Groß Köris (dieselbe Regel wie plz_ort_passt)", kurzOrt.length === 2 && kurzOrt.every((k) => k.ort === "Groß Köris"), kurzOrt);
      const ortsteil = await fuerOrt("Altstadt-Mitte");
      pruefe("E72 e: Ortsteil „Altstadt-Mitte“ findet Altstadt", ortsteil.length === 1 && ortsteil[0]!.ort === "Altstadt", ortsteil);
      const nichts = await fuerOrt("Xyzzy");
      pruefe("Rot: unbekannter Ort -> keine Zeile", nichts.length === 0, nichts);
      const ohneVg = eindeutig[0]!;
      pruefe("E72: ohne VG250-Ebenen sind Kreis und Land null (kein erfundener Kreis)", ohneVg.kreis === null && ohneVg.land === null, ohneVg);
      for (const ort of ["Altstadt", "Gross", "Altstadt-Mitte", "Xyzzy", "Pforzheim"]) {
        const [p] = await sql`select (select count(*)::int from plz_fuer_ort(${ort})) as a, (select count(*)::int from plz_ort o where plz_ort_passt(${ort}, o.ort_norm)) as b`;
        pruefe(`E72 Paritaet plz_fuer_ort = plz_ort_passt ueber plz_ort („${ort}“)`, p!.a === p!.b, p);
      }
    }
  }

  // E68 PR 3: Messung des lokalen Import-Schritts — 5.000 (PLZ, Ort) in EINER
  // Abfrage (dieselbe Form wie pruefePlzOrtStapel in der App). Nur mit Bestand.
  // postgres-js: jsonb nur ueber sql.json() binden (ein String wird sonst JSON-Skalar).
  if (n > 0 && !fixture) {
    const probe = (await sql`select plz, ort from plz_ort order by random() limit 5000`) as unknown as { plz: string; ort: string }[];
    const eintraege = probe.map((p, i) => ({ i, plz: p.plz, ort: i % 10 === 0 ? "Xyzzy" : p.ort }));
    const t0 = Date.now();
    const rows = await sql`
      with e as (select t.i, t.plz, nullif(t.ort, '') as ort
                 from jsonb_to_recordset(${sql.json(eintraege)}) as t(i int, plz text, ort text))
      select e.i, p.plz_bekannt, p.ort_passt, ST_X(q.pt) as lng
      from e cross join lateral plz_pruefung(e.plz, e.ort) p
      left join lateral (select ST_PointOnSurface(g.geom) as pt from plz_gebiet g where g.plz = e.plz) q on true
      order by e.i`;
    const dauer = Date.now() - t0;
    const passt = rows.filter((r) => r.ort_passt).length;
    console.log(`PLZMESSUNG ${JSON.stringify({ zeilen: rows.length, dauer_ms: dauer, ort_passt: passt, ort_falsch: rows.length - passt })}`);
    pruefe("Messung: 5.000 Zeilen lokal in einer Abfrage, jede zehnte mit falschem Ort", rows.length === eintraege.length && passt === rows.length - Math.ceil(eintraege.length / 10), { dauer });

    // E72: PLZ aus Ort — 200 verschiedene Orte in EINER Abfrage (dieselbe Form
    // wie plzFuerOrtStapel in der App). Jeder Ort scannt plz_ort einmal mit
    // der Passt-Regel auf Normalformen; die Dauer sagt, ob das fuer einen
    // Import ohne PLZ-Spalte reicht.
    const orte = (await sql`select distinct ort from plz_ort order by ort limit 200`) as unknown as { ort: string }[];
    const ortEintraege = orte.map((o, i) => ({ i, ort: o.ort }));
    const t1 = Date.now();
    const kandidaten = await sql`
      with e as (select t.i, t.ort from jsonb_to_recordset(${sql.json(ortEintraege)}) as t(i int, ort text))
      select e.i, count(k.plz)::int as n
      from e left join lateral plz_fuer_ort(e.ort) k on true
      group by e.i order by e.i`;
    const dauerOrt = Date.now() - t1;
    const mitTreffer = kandidaten.filter((r) => Number(r.n) > 0).length;
    console.log(`PLZMESSUNG_ORT ${JSON.stringify({ orte: ortEintraege.length, dauer_ms: dauerOrt, mit_treffer: mitTreffer })}`);
    // Plan derselben Abfrage (Eric 08.10.2026: Seq Scan oder Index?) — nur Zaehlungen und Knoten, keine Ortsnamen.
    const plan = (await sql`explain (analyze, buffers, costs off, timing off, format text)
      with e as (select t.i, t.ort from jsonb_to_recordset(${sql.json(ortEintraege)}) as t(i int, ort text))
      select e.i, count(k.plz)::int as n
      from e left join lateral plz_fuer_ort(e.ort) k on true
      group by e.i order by e.i`) as unknown as { "QUERY PLAN": string }[];
    for (const z of plan) console.log(`PLZEXPLAIN_ORT ${z["QUERY PLAN"]}`);
    const [idx] = await sql`select count(*)::int as n from pg_indexes where tablename = 'plz_ort'`;
    console.log(`PLZEXPLAIN_ORT indizes_plz_ort=${idx!.n} zeilen_plz_ort=${(await sql`select count(*)::int as n from plz_ort`)[0]!.n}`);
    pruefe("E72 Messung: 200 Orte in einer Abfrage, jeder findet mindestens seine eigene PLZ", kandidaten.length === ortEintraege.length && mitTreffer === ortEintraege.length, { dauerOrt });
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
