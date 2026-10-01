/**
 * AP2.5 PR a1 (E66): Preview-Testdaten fuer akteure. — als Seed-Skript, keine
 * Migration (Migrationen erfinden keine Fachdaten). Laeuft NUR gegen die
 * Preview (pruefeSeedZiel: einzige Variable SEED_DATABASE_URL_PREVIEW, kein
 * Override; Rot-Nachweis im PR). Idempotent und als Testdaten gekennzeichnet:
 *
 *  1. Sitz des Bestands: jeder Seed-Akteur ('Seed: %') ohne Sitz bekommt
 *     PLZ, Ort und Pin aus dem Standort seines AELTESTEN Stroms (bewusst
 *     gewaehlt, bei mehreren Orten wird die Wahl ausgegeben). Strasse bleibt
 *     leer (unvollstaendig im Sinne von E66), die Hausnummer ebenso.
 *  2. Mindestens 40 zusaetzliche Akteure 'Seed-A25: %' ueber alle Sektoren
 *     und mehrere Orte/Kreise, mit Stroemen und Belegen aller sieben
 *     Belegtypen (beleg.metadata.seed = 'SEED-A25', Strom-Bezeichnung endet
 *     auf ' · SEED-A25'). Bewusst dabei: Dubletten-Kandidaten (stark:
 *     aehnlicher Name, gleiche PLZ; schwach: nur aehnlicher Name), verwaiste
 *     (teils aelter als der Verwaist-Parameter), unvollstaendige (ohne
 *     Strasse oder ohne Pin), einige 'ohne Sektor'. Kontaktpersonen kommen
 *     mit PR b.
 *
 * Loeschen: nur die SEED-A25-Zeilen (Stroeme, Belege, Akteure ohne fremde
 * Referenz) — nie TRUNCATE, nie den 'Seed: %'-Bestand (seed-preview.ts) und
 * nie 'Test:'-Daten.
 */
import { createHash } from "node:crypto";

import { createSql } from "@bhyo/db";

import { pruefeSeedZiel } from "./seed-guard";

const ziel = pruefeSeedZiel(process.env);
if ("fehler" in ziel) {
  console.error(`Abbruch: ${ziel.fehler}`);
  process.exit(1);
}
const zielUrl = "url" in ziel ? ziel.url : "";
const sql = createSql(zielUrl);

const PRAEFIX = "Seed-A25: ";
const MARKER = " · SEED-A25";
const BELEG_MARKER = "SEED-A25";

/** Deterministische UUID (v5-artig) aus einem Schluessel — derselbe Schluessel ist dieselbe Zeile. */
function uuid(key: string): string {
  const h = createHash("sha1").update("bhyo-seed-a25:" + key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Orte mit PLZ und Koordinate (Kreise der Region, wie seed-daten.ts). */
const ORTE: { ort: string; plz: string; lng: number; lat: number }[] = [
  { ort: "Speyer", plz: "67346", lng: 8.43, lat: 49.32 },
  { ort: "Ludwigshafen", plz: "67059", lng: 8.44, lat: 49.48 },
  { ort: "Frankenthal", plz: "67227", lng: 8.35, lat: 49.53 },
  { ort: "Worms", plz: "67547", lng: 8.36, lat: 49.63 },
  { ort: "Landau", plz: "76829", lng: 8.12, lat: 49.2 },
  { ort: "Neustadt a. d. W.", plz: "67433", lng: 8.14, lat: 49.35 },
  { ort: "Bad Dürkheim", plz: "67098", lng: 8.17, lat: 49.46 },
  { ort: "Grünstadt", plz: "67269", lng: 8.17, lat: 49.57 },
  { ort: "Heidelberg", plz: "69117", lng: 8.69, lat: 49.41 },
  { ort: "Mannheim", plz: "68159", lng: 8.47, lat: 49.49 },
  { ort: "Weinheim", plz: "69469", lng: 8.67, lat: 49.55 },
  { ort: "Sinsheim", plz: "74889", lng: 8.88, lat: 49.25 },
  { ort: "Wiesloch", plz: "69168", lng: 8.7, lat: 49.29 },
  { ort: "Bruchsal", plz: "76646", lng: 8.6, lat: 49.12 },
  { ort: "Eppingen", plz: "75031", lng: 8.91, lat: 49.14 },
  { ort: "Mosbach", plz: "74821", lng: 9.15, lat: 49.35 },
  { ort: "Eberbach", plz: "69412", lng: 8.99, lat: 49.47 },
  { ort: "Buchen", plz: "74722", lng: 9.32, lat: 49.52 },
  { ort: "Walldürn", plz: "74731", lng: 9.37, lat: 49.58 },
  { ort: "Hockenheim", plz: "68766", lng: 8.55, lat: 49.32 },
  { ort: "Schwetzingen", plz: "68723", lng: 8.57, lat: 49.38 },
  { ort: "Germersheim", plz: "76726", lng: 8.37, lat: 49.22 },
  { ort: "Haßloch", plz: "67454", lng: 8.26, lat: 49.36 },
];
const PLZ_JE_ORT = new Map(ORTE.map((o) => [o.ort, o.plz]));

const BELEG_TYPEN = ["gespraech", "dokument", "webrecherche", "betriebsdaten", "vertrag", "absichtserklaerung", "angebot"] as const;

interface A25Akteur {
  key: string;
  name: string;
  sektor: string;
  ortIdx: number;
  /** Sitz: Strasse fehlt = unvollstaendig; Pin fehlt = unvollstaendig. */
  strasse: string | null;
  ohnePin?: boolean;
  /** Anzahl Stroeme (0 = verwaist). */
  stroeme: number;
  /** created_at zurueckdatiert (Monate) — fuer den Verwaist-Hinweis. */
  alterMonate?: number;
  /** Stroeme ohne Beleg (ohne_beleg). */
  ohneBeleg?: boolean;
  hinweis?: string;
}

/** Mindestens 40 Akteure ueber alle Sektoren und Orte — Namen mit Rechtsformen fuer die Normalisierung (PR c). */
const AKTEURE: A25Akteur[] = [
  // Dubletten stark (aehnlicher Name, gleiche PLZ)
  { key: "mueller-agrar-1", name: "Müller Agrar GmbH", sektor: "landwirtschaft", ortIdx: 11, strasse: "Hauptstraße 12", stroeme: 2, hinweis: "Dublette stark A" },
  { key: "mueller-agrar-2", name: "Mueller Agrar", sektor: "landwirtschaft", ortIdx: 11, strasse: "Bahnhofstraße 3", stroeme: 1, hinweis: "Dublette stark A" },
  { key: "stadtwerke-speyer-1", name: "Stadtwerke Speyer GmbH", sektor: "energie", ortIdx: 0, strasse: "Industriestraße 9", stroeme: 2, hinweis: "Dublette stark B" },
  { key: "stadtwerke-speyer-2", name: "Stadtwerke Speyer", sektor: "energie", ortIdx: 0, strasse: null, stroeme: 1, hinweis: "Dublette stark B, unvollstaendig" },
  { key: "biogas-kraich-1", name: "Biogas Kraichgau GmbH & Co. KG", sektor: "energie", ortIdx: 14, strasse: "Am Hof 1", stroeme: 1, hinweis: "Dublette stark C" },
  { key: "biogas-kraich-2", name: "Biogas Kraichgau KG", sektor: "energie", ortIdx: 14, strasse: "Am Hof 1", stroeme: 1, hinweis: "Dublette stark C" },
  // Dubletten schwach (nur aehnlicher Name, andere PLZ)
  { key: "forst-rhein-1", name: "Forstbetrieb Rheinhessen e.K.", sektor: "forstwirtschaft", ortIdx: 3, strasse: "Waldweg 4", stroeme: 1, hinweis: "Dublette schwach D" },
  { key: "forst-rhein-2", name: "Forstbetrieb Rheinhessen", sektor: "forstwirtschaft", ortIdx: 7, strasse: "Waldweg 4", stroeme: 1, hinweis: "Dublette schwach D" },
  { key: "papier-neckar-1", name: "Papierfabrik Neckartal AG", sektor: "industrie", ortIdx: 16, strasse: "Neckarstraße 20", stroeme: 2, hinweis: "Dublette schwach E" },
  { key: "papier-neckar-2", name: "Papierfabrik Neckartal", sektor: "industrie", ortIdx: 15, strasse: "Neckarstraße 20", stroeme: 1, hinweis: "Dublette schwach E" },
  // Verwaiste (ohne Strom) — drei aelter als der Parameter (6 Monate), drei jung
  { key: "verwaist-alt-1", name: "Altholz Pfalz GmbH", sektor: "holzwirtschaft", ortIdx: 4, strasse: "Holzweg 2", stroeme: 0, alterMonate: 8, hinweis: "verwaist, 8 Monate" },
  { key: "verwaist-alt-2", name: "Kompostwerk Vorderpfalz", sektor: "abfallwirtschaft", ortIdx: 5, strasse: "Deponiestraße 1", stroeme: 0, alterMonate: 12, hinweis: "verwaist, 12 Monate" },
  { key: "verwaist-alt-3", name: "Gemeinde Haßloch", sektor: "kommunal", ortIdx: 22, strasse: "Rathausplatz 1", stroeme: 0, alterMonate: 7, hinweis: "verwaist, 7 Monate" },
  { key: "verwaist-jung-1", name: "Hof Sonnenberg GbR", sektor: "landwirtschaft", ortIdx: 6, strasse: "Sonnenberg 5", stroeme: 0, alterMonate: 1, hinweis: "verwaist, 1 Monat" },
  { key: "verwaist-jung-2", name: "Brauerei Bruchsal", sektor: "lebensmittel", ortIdx: 13, strasse: "Brauergasse 7", stroeme: 0, hinweis: "verwaist, neu" },
  { key: "verwaist-jung-3", name: "Stadt Hockenheim", sektor: "kommunal", ortIdx: 19, strasse: null, stroeme: 0, hinweis: "verwaist, neu, unvollstaendig" },
  // Unvollstaendig (ohne Strasse / ohne Pin)
  { key: "unvoll-1", name: "Sägewerk Odenwald GmbH", sektor: "holzwirtschaft", ortIdx: 17, strasse: null, stroeme: 1, hinweis: "unvollstaendig: ohne Strasse" },
  { key: "unvoll-2", name: "Mühle am Neckar", sektor: "lebensmittel", ortIdx: 8, strasse: "Mühlweg 2", ohnePin: true, stroeme: 1, hinweis: "unvollstaendig: ohne Pin" },
  { key: "unvoll-3", name: "Landkreis Germersheim", sektor: "kommunal", ortIdx: 21, strasse: null, ohnePin: true, stroeme: 2, hinweis: "unvollstaendig: ohne Strasse und Pin" },
  // Ohne Sektor (bewusste Auswahl, Systemzeile)
  { key: "ohne-1", name: "Verein Streuobst Weinstraße e.V.", sektor: "ohne_sektor", ortIdx: 4, strasse: "Obstgasse 3", stroeme: 1, hinweis: "ohne Sektor" },
  { key: "ohne-2", name: "Projektgesellschaft Rhein-Neckar mbH", sektor: "ohne_sektor", ortIdx: 9, strasse: "Planckstraße 8", stroeme: 1, hinweis: "ohne Sektor" },
  { key: "ohne-3", name: "Initiative Walldürn", sektor: "ohne_sektor", ortIdx: 18, strasse: null, stroeme: 0, hinweis: "ohne Sektor, verwaist" },
  // Ohne Beleg (Stroeme ohne Belegdatei)
  { key: "ohnebeleg-1", name: "Gärtnerei Weinheim OHG", sektor: "landwirtschaft", ortIdx: 10, strasse: "Gartenstraße 1", stroeme: 2, ohneBeleg: true, hinweis: "ohne Beleg" },
  { key: "ohnebeleg-2", name: "Entsorgung Mannheim GmbH", sektor: "abfallwirtschaft", ortIdx: 9, strasse: "Hafenstraße 50", stroeme: 1, ohneBeleg: true, hinweis: "ohne Beleg" },
  // Regelfaelle ueber alle Sektoren und Orte
  { key: "r-1", name: "Zuckerfabrik Wiesloch AG", sektor: "lebensmittel", ortIdx: 12, strasse: "Fabrikstraße 1", stroeme: 2 },
  { key: "r-2", name: "Raiffeisen Mosbach eG", sektor: "landwirtschaft", ortIdx: 15, strasse: "Marktstraße 4", stroeme: 1 },
  { key: "r-3", name: "Stadt Landau", sektor: "kommunal", ortIdx: 4, strasse: "Marktstraße 50", stroeme: 1 },
  { key: "r-4", name: "Chemiepark Ludwigshafen GmbH", sektor: "industrie", ortIdx: 1, strasse: "Carl-Bosch-Straße 38", stroeme: 2 },
  { key: "r-5", name: "Holzhof Buchen GbR", sektor: "holzwirtschaft", ortIdx: 17, strasse: "Am Holzplatz 2", stroeme: 1 },
  { key: "r-6", name: "AVR Abfallverwertung Rhein-Neckar", sektor: "abfallwirtschaft", ortIdx: 12, strasse: "Dietmar-Hopp-Straße 8", stroeme: 2 },
  { key: "r-7", name: "Energie Südwest AG", sektor: "energie", ortIdx: 4, strasse: "Industriestraße 18", stroeme: 1 },
  { key: "r-8", name: "Weingut Bad Dürkheim", sektor: "landwirtschaft", ortIdx: 6, strasse: "Weinstraße 100", stroeme: 1 },
  { key: "r-9", name: "Forstamt Pfälzerwald", sektor: "forstwirtschaft", ortIdx: 5, strasse: "Forsthausweg 1", stroeme: 2 },
  { key: "r-10", name: "Stadtreinigung Heidelberg", sektor: "abfallwirtschaft", ortIdx: 8, strasse: "Hardtstraße 2", stroeme: 1 },
  { key: "r-11", name: "Bäckerei Worms GmbH", sektor: "lebensmittel", ortIdx: 3, strasse: "Backgasse 9", stroeme: 1 },
  { key: "r-12", name: "Gemeinde Eberbach", sektor: "kommunal", ortIdx: 16, strasse: "Leopoldsplatz 1", stroeme: 1 },
  { key: "r-13", name: "Pellets Rhein-Neckar GmbH", sektor: "holzwirtschaft", ortIdx: 20, strasse: "Schälzigweg 3", stroeme: 1 },
  { key: "r-14", name: "Agrargenossenschaft Eppingen", sektor: "landwirtschaft", ortIdx: 14, strasse: "Feldweg 11", stroeme: 1 },
  { key: "r-15", name: "Biomassehof Frankenthal e.K.", sektor: "energie", ortIdx: 2, strasse: "Mörscher Straße 20", stroeme: 2 },
  { key: "r-16", name: "Papier & Pappe Germersheim", sektor: "industrie", ortIdx: 21, strasse: "Rheinstraße 7", stroeme: 1 },
  { key: "r-17", name: "Stadt Schwetzingen", sektor: "kommunal", ortIdx: 20, strasse: "Hebelstraße 1", stroeme: 1 },
  { key: "r-18", name: "Sägewerk Walldürn GmbH & Co. KG", sektor: "holzwirtschaft", ortIdx: 18, strasse: "Sägeweg 6", stroeme: 1 },
];

async function main() {
  const host = new URL(zielUrl).hostname;
  console.log(`SEED-A25 host=${host}`);

  // Stammdaten-Guard: Sektoren (inkl. Systemzeile), Materialarten, Produkte muessen existieren.
  const sektoren = (await sql`select code from sektor where aktiv`).map((r) => r.code as string);
  const fehlend = [...new Set(AKTEURE.map((a) => a.sektor))].filter((s) => !sektoren.includes(s));
  if (fehlend.length) {
    console.error(`Abbruch: unbekannte Sektoren ${fehlend.join(", ")} (Migration 0035 fuer ohne_sektor?).`);
    process.exit(1);
  }
  const materialarten = (await sql`select code from materialart order by code`).map((r) => r.code as string);
  const produkte = (await sql`select code from output_produkt order by code`).map((r) => r.code as string);
  if (!materialarten.length || !produkte.length) {
    console.error("Abbruch: keine Materialarten/Produkte in der Referenztabelle.");
    process.exit(1);
  }

  // 1. Sitz des Bestands aus dem aeltesten Strom-Standort (bewusst gewaehlt, Mehrfach-Orte werden genannt).
  const bestand = await sql`
    with s as (
      select akteur_id, ort, standort_geom, created_at from biomassestrom
      union all
      select akteur_id, ort, standort_geom, created_at from output_bedarf
    ), erster as (
      select distinct on (akteur_id) akteur_id, ort, standort_geom from s where ort is not null order by akteur_id, created_at, ort
    ), orte as (
      select akteur_id, count(distinct lower(btrim(ort)))::int as n from s where ort is not null group by akteur_id
    )
    select a.id, a.name, e.ort, ST_X(e.standort_geom::geometry) as lng, ST_Y(e.standort_geom::geometry) as lat, coalesce(o.n, 0) as orte
      from akteur a
      left join erster e on e.akteur_id = a.id
      left join orte o on o.akteur_id = a.id
     where a.name like 'Seed: %' and a.sitz_plz is null`;
  let sitzGesetzt = 0;
  let sitzOhneStrom = 0;
  for (const a of bestand) {
    const ort = a.ort as string | null;
    if (!ort) {
      sitzOhneStrom += 1;
      continue;
    }
    const plz = PLZ_JE_ORT.get(ort) ?? "00000";
    if (Number(a.orte) > 1) console.log(`SITZ_WAHL ${a.name}: ${Number(a.orte)} Orte, gewaehlt ${ort} (aeltester Strom)`);
    await sql`update akteur set sitz_plz = ${plz}, sitz_ort = ${ort},
      sitz_geom = ${a.lng == null ? null : sql`ST_SetSRID(ST_MakePoint(${Number(a.lng)}, ${Number(a.lat)}), 4326)`}
      where id = ${a.id}`;
    sitzGesetzt += 1;
  }
  console.log(`SITZ_BESTAND gesetzt=${sitzGesetzt} ohne_strom_standort=${sitzOhneStrom}`);

  // 2. SEED-A25-Zeilen loeschen (Marker, FK-Reihenfolge), dann neu einfuegen.
  await sql.begin(async (tx) => {
    await tx`delete from vergabe_zeitraum where biomassestrom_id in (select id from biomassestrom where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from vergabe_zeitraum where output_bedarf_id in (select id from output_bedarf where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from inbox_eintrag where biomassestrom_id in (select id from biomassestrom where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from inbox_eintrag where output_bedarf_id in (select id from output_bedarf where bezeichnung like ${"%" + MARKER})`;
    await tx`delete from biomassestrom where bezeichnung like ${"%" + MARKER}`;
    await tx`delete from output_bedarf where bezeichnung like ${"%" + MARKER}`;
    await tx`delete from beleg where metadata->>'seed' = ${BELEG_MARKER}`;
    await tx`delete from akteur where name like ${PRAEFIX + "%"}
      and not exists (select 1 from biomassestrom b where b.akteur_id = akteur.id)
      and not exists (select 1 from output_bedarf o where o.akteur_id = akteur.id)`;
  });

  let belegTyp = 0;
  let stroemeAngelegt = 0;
  await sql.begin(async (tx) => {
    for (const a of AKTEURE) {
      const id = uuid("akteur:" + a.key);
      const o = ORTE[a.ortIdx]!;
      const [strasse, hausnummer] = a.strasse ? [a.strasse.replace(/\s+\d+\w*$/, ""), a.strasse.match(/\s(\d+\w*)$/)?.[1] ?? null] : [null, null];
      const erstellt = a.alterMonate ? sql`now() - make_interval(months => ${a.alterMonate})` : sql`now()`;
      await tx`insert into akteur (id, name, sektor, status, sitz_strasse, sitz_hausnummer, sitz_plz, sitz_ort, sitz_geom, created_at)
        values (${id}, ${PRAEFIX + a.name}, ${a.sektor}, 'geprueft', ${strasse}, ${hausnummer}, ${o.plz}, ${o.ort},
                ${a.ohnePin ? null : sql`ST_SetSRID(ST_MakePoint(${o.lng + 0.003}, ${o.lat - 0.002}), 4326)`}, ${erstellt})
        on conflict (id) do update set name = excluded.name, sektor = excluded.sektor, sitz_strasse = excluded.sitz_strasse,
          sitz_hausnummer = excluded.sitz_hausnummer, sitz_plz = excluded.sitz_plz, sitz_ort = excluded.sitz_ort,
          sitz_geom = excluded.sitz_geom, created_at = excluded.created_at`;
      for (let i = 0; i < a.stroeme; i++) {
        let belegId: string | null = null;
        if (!a.ohneBeleg) {
          const typ = BELEG_TYPEN[belegTyp++ % BELEG_TYPEN.length]!;
          const mitGueltigBis = ["betriebsdaten", "vertrag", "absichtserklaerung", "angebot"].includes(typ);
          const [b] = await tx`insert into beleg (typ, extern_nachvollziehbar, link_url, gueltig_bis, metadata, erstellt_am)
            values (${typ}::beleg_typ, false, ${typ === "webrecherche" ? `https://example.org/seed-a25/${a.key}` : null},
                    ${mitGueltigBis ? sql`(current_date + ${30 + i * 90})` : null},
                    ${tx.json({ seed: BELEG_MARKER, quellenangabe: `Seed-A25 ${typ} ${a.key}` })}, now())
            returning id`;
          belegId = b!.id as string;
        }
        const stromId = uuid(`strom:${a.key}:${i}`);
        const bezeichnung = `${a.name} Strom ${i + 1}${MARKER}`;
        if (i % 3 === 2) {
          await tx`insert into output_bedarf (id, akteur_id, bezeichnung, ort, plz, standort_geom, produkt_code, menge_wert, menge_einheit, preis, preis_einheit, preis_herkunft,
              zeitraum_von, zeitraum_bis, saisonalitaet, beleg_id, status, reserviert_bhyo, reserviert_seit)
            values (${stromId}, ${id}, ${bezeichnung}, ${o.ort}, ${o.plz}, ${sql`ST_SetSRID(ST_MakePoint(${o.lng + 0.01}, ${o.lat + 0.01}), 4326)`},
              ${produkte[i % produkte.length]!}, 500, 't/a', null, null, null, '2026-01', '2027-12', ${tx.json(Array(12).fill(1))}, ${belegId}, 'entwurf', false, null)`;
        } else {
          await tx`insert into biomassestrom (id, akteur_id, bezeichnung, ort, plz, standort_geom, materialart_code, menge_roh_fm, ts_anteil_pct, aschegehalt_pct,
              zeitraum_von, zeitraum_bis, saisonalitaet, preis_min, preis_mittel, preis_max, preis_herkunft, beleg_id, status, reserviert_bhyo, reserviert_seit)
            values (${stromId}, ${id}, ${bezeichnung}, ${o.ort}, ${o.plz}, ${sql`ST_SetSRID(ST_MakePoint(${o.lng + 0.01 * (i + 1)}, ${o.lat - 0.01}), 4326)`},
              ${materialarten[(a.ortIdx + i) % materialarten.length]!}, ${1000 + i * 250}, 45, 5, '2026-01', '2027-12', ${tx.json(Array(12).fill(1))},
              null, null, null, null, ${belegId}, ${belegId ? "geprueft" : "entwurf"}, false, null)`;
        }
        stroemeAngelegt += 1;
      }
    }
  });

  // Selbstpruefung
  const [z] = await sql`select
      (select count(*)::int from akteur where name like ${PRAEFIX + "%"}) as akteure,
      (select count(*)::int from akteur where name like ${PRAEFIX + "%"} and sektor = 'ohne_sektor') as ohne_sektor,
      (select count(*)::int from akteur a where a.name like ${PRAEFIX + "%"} and not exists (select 1 from biomassestrom b where b.akteur_id = a.id) and not exists (select 1 from output_bedarf o where o.akteur_id = a.id)) as verwaist,
      (select count(*)::int from akteur where name like ${PRAEFIX + "%"} and (sitz_strasse is null or sitz_geom is null)) as unvollstaendig,
      (select count(distinct sektor)::int from akteur where name like ${PRAEFIX + "%"}) as sektoren,
      (select count(distinct sitz_plz)::int from akteur where name like ${PRAEFIX + "%"}) as plz,
      (select count(distinct typ)::int from beleg where metadata->>'seed' = ${BELEG_MARKER}) as belegtypen,
      (select count(*)::int from akteur where name like 'Seed: %' and sitz_plz is null) as bestand_ohne_sitz`;
  console.log("SEED-A25 " + JSON.stringify({ ...z, stroeme: stroemeAngelegt }));
  const fehler: string[] = [];
  if (Number(z!.akteure) < 40) fehler.push(`nur ${z!.akteure} Akteure (mindestens 40)`);
  if (Number(z!.belegtypen) !== BELEG_TYPEN.length) fehler.push(`nur ${z!.belegtypen} Belegtypen (alle ${BELEG_TYPEN.length})`);
  if (Number(z!.sektoren) < 9) fehler.push(`nur ${z!.sektoren} Sektoren`);
  if (Number(z!.verwaist) < 3 || Number(z!.unvollstaendig) < 3 || Number(z!.ohne_sektor) < 2) fehler.push("Sonderfaelle fehlen (verwaist/unvollstaendig/ohne Sektor)");
  await sql.end();
  if (fehler.length) {
    console.error("VERLETZUNGEN:\n- " + fehler.join("\n- "));
    process.exit(1);
  }
  console.log("Alle Invarianten erfuellt.");
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
