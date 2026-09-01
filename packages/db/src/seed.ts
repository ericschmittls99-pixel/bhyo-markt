/**
 * Seed-Skript fuer die PREVIEW-Datenbank. Legt idempotent Testdaten an, damit
 * das Register mit echten Zeilen und allen vier Qualitaetsstufen sichtbar wird.
 *
 * - Idempotent: Testdaten tragen den Praefix "Test:" (Belege den Marker
 *   metadata.seed=true) und werden vor jedem Lauf entfernt und neu angelegt.
 *   Materialart-Grundwerte sind echte Referenzdaten und werden nur upserted.
 * - Sicherheit: laeuft NUR mit ALLOW_PREVIEW_SEED=1 und niemals gegen Production.
 *   Selbst dann wuerde es ausschliesslich "Test:"-Daten anfassen.
 *
 * Aufruf: ALLOW_PREVIEW_SEED=1 DATABASE_URL=<preview> pnpm --filter @bhyo/db seed
 */
import { createSql } from "./client";

const url = process.env.DATABASE_URL;
if (!process.env.ALLOW_PREVIEW_SEED || !url) {
  console.error(
    "Abbruch: ALLOW_PREVIEW_SEED=1 und DATABASE_URL (Preview) sind erforderlich.",
  );
  process.exit(1);
}
// Grober Schutz gegen versehentliches Seeden der Production-DB.
if (/prod/i.test(url)) {
  console.error("Abbruch: DATABASE_URL sieht nach Production aus.");
  process.exit(1);
}

const sql = createSql(url);
const uuid = () => crypto.randomUUID();
const gleich = () => Array.from({ length: 12 }, () => Math.round((100 / 12) * 10) / 10);
const winter = () => [16, 15, 12, 6, 3, 2, 2, 2, 5, 10, 12, 15];
const ernte = () => [1, 1, 2, 4, 6, 9, 18, 22, 18, 10, 5, 4];

type Grade = "A" | "B" | "C" | "D";

interface BelegSpec {
  typ: string;
  extern: boolean;
  amtlich?: boolean;
  quellenangabe: string;
  erhebungsdatum: string;
  dateiKey?: string;
  linkUrl?: string;
  gueltigBis?: string;
  gespraechsdatum?: string;
  gespraechspartner?: string;
}

async function insertBeleg(spec: BelegSpec): Promise<string> {
  const id = uuid();
  const metadata: Record<string, string | boolean> = {
    seed: true,
    quellenangabe: spec.quellenangabe,
  };
  if (spec.amtlich !== undefined) metadata.amtlich = spec.amtlich;
  if (spec.gespraechsdatum) metadata.gespraechsdatum = spec.gespraechsdatum;
  if (spec.gespraechspartner) metadata.gespraechspartner = spec.gespraechspartner;

  await sql`
    insert into beleg
      (id, typ, datei_key, link_url, extern_nachvollziehbar, metadata, gueltig_bis, erstellt_am)
    values
      (${id}, ${spec.typ}, ${spec.dateiKey ?? null}, ${spec.linkUrl ?? null},
       ${spec.extern}, ${sql.json(metadata)}, ${spec.gueltigBis ?? null},
       ${spec.erhebungsdatum})`;
  return id;
}

async function main() {
  console.log("Entferne bestehende Test-Daten…");
  await sql`delete from biomassestrom where bezeichnung like 'Test:%'`;
  await sql`delete from output_bedarf where bezeichnung like 'Test:%'`;
  await sql`delete from beleg where metadata->>'seed' = 'true'`;
  await sql`delete from akteur where name like 'Test:%'`;
  await sql`delete from region where name like 'Test:%'`;

  // --- Materialart-Grundwerte (echte Referenzdaten, nur upsert) ---
  const materialarten = [
    ["guelle", "Gülle"],
    ["mist", "Mist"],
    ["bioabfall", "Bioabfall"],
    ["gruenschnitt", "Grünschnitt"],
    ["stroh", "Stroh"],
  ];
  for (const [code, label] of materialarten) {
    await sql`insert into materialart (code, label) values (${code}, ${label})
      on conflict (code) do nothing`;
  }

  // --- Regionen (mit Einzugsradius, ohne region_id an den Stroemen) ---
  const regionen = [
    { name: "Test: Region Schwarzwald", lng: 8.24, lat: 48.0, radius: "40" },
    { name: "Test: Region Schwäbische Alb", lng: 9.47, lat: 48.4, radius: "35" },
    { name: "Test: Region Kraichgau", lng: 8.7, lat: 49.1, radius: "30" },
  ];
  for (const r of regionen) {
    await sql`
      insert into region (id, name, standort_geom, einzugsradius_km)
      values (${uuid()}, ${r.name},
              ST_SetSRID(ST_MakePoint(${r.lng}, ${r.lat}), 4326), ${r.radius})`;
  }

  // --- Akteure ---
  const akteure = [
    { name: "Test: Sägewerk Höllental", sektor: "Forstwirtschaft" },
    { name: "Test: Milchhof Alb", sektor: "Landwirtschaft" },
    { name: "Test: Bioenergie Kraichgau GmbH", sektor: "Energie" },
    { name: "Test: Kompostwerk Breisgau", sektor: "Entsorgung" },
    { name: "Test: Agrar Genossenschaft Donautal", sektor: "Landwirtschaft" },
  ];
  const akteurId: Record<string, string> = {};
  for (const a of akteure) {
    const id = uuid();
    akteurId[a.name] = id;
    await sql`insert into akteur (id, name, sektor, status)
      values (${id}, ${a.name}, ${a.sektor}, 'entwurf')`;
  }
  const A = (n: string) => akteurId[`Test: ${n}`]!;

  // --- Biomasseströme: alle 6 Beleg-Typen, beide Vollstaendigkeits-Zustaende,
  //     dadurch alle vier Qualitaetsstufen A–D sichtbar (inkl. betriebsdaten→A). ---
  const stroeme: Array<{
    bez: string;
    akteur: string;
    mat: string;
    ort: string;
    lk: string;
    lng: number;
    lat: number;
    roh: string;
    ts: string;
    asche: string;
    saison: number[];
    preis: [string, string, string];
    qual: Grade;
    beleg: BelegSpec;
  }> = [
    {
      bez: "Test: Rindergülle Milchhof",
      akteur: "Milchhof Alb",
      mat: "guelle",
      ort: "Münsingen",
      lk: "Reutlingen",
      lng: 9.5,
      lat: 48.41,
      roh: "3200",
      ts: "8",
      asche: "12",
      saison: gleich(),
      preis: ["2", "4", "6"],
      qual: "A",
      beleg: {
        typ: "betriebsdaten",
        extern: true,
        quellenangabe: "Betriebstagebuch 2025",
        erhebungsdatum: "2025-03-01",
        dateiKey: `belege/preview/seed/${uuid()}.pdf`,
      },
    },
    {
      bez: "Test: Waldrestholz Höllental",
      akteur: "Sägewerk Höllental",
      mat: "gruenschnitt",
      ort: "Kirchzarten",
      lk: "Breisgau-Hochschwarzwald",
      lng: 8.05,
      lat: 47.96,
      roh: "1800",
      ts: "55",
      asche: "3",
      saison: winter(),
      preis: ["30", "42", "55"],
      qual: "A",
      beleg: {
        typ: "vertrag",
        extern: true,
        quellenangabe: "Liefervertrag 2025-14",
        erhebungsdatum: "2025-01-20",
        dateiKey: `belege/preview/seed/${uuid()}.pdf`,
      },
    },
    {
      bez: "Test: Pferdemist Reithof",
      akteur: "Agrar Genossenschaft Donautal",
      mat: "mist",
      ort: "Ehingen",
      lk: "Alb-Donau-Kreis",
      lng: 9.72,
      lat: 48.28,
      roh: "600",
      ts: "30",
      asche: "18",
      saison: gleich(),
      preis: ["5", "8", "12"],
      qual: "B",
      beleg: {
        typ: "absichtserklaerung",
        extern: true,
        quellenangabe: "LOI Genossenschaft",
        erhebungsdatum: "2025-02-10",
        dateiKey: `belege/preview/seed/${uuid()}.pdf`,
      },
    },
    {
      bez: "Test: Bioabfall Landkreis",
      akteur: "Kompostwerk Breisgau",
      mat: "bioabfall",
      ort: "Freiburg",
      lk: "Breisgau-Hochschwarzwald",
      lng: 8.3,
      lat: 48.02,
      roh: "9500",
      ts: "35",
      asche: "22",
      saison: gleich(),
      preis: ["0", "0", "0"],
      qual: "B",
      beleg: {
        typ: "dokument_link",
        extern: true,
        amtlich: true,
        quellenangabe: "Abfallbilanz Landkreis (amtlich)",
        erhebungsdatum: "2025-04-05",
        linkUrl: "https://example.org/abfallbilanz-2024",
      },
    },
    {
      bez: "Test: Stroh Kraichgau",
      akteur: "Agrar Genossenschaft Donautal",
      mat: "stroh",
      ort: "Bruchsal",
      lk: "Karlsruhe",
      lng: 8.6,
      lat: 49.12,
      roh: "2400",
      ts: "86",
      asche: "6",
      saison: ernte(),
      preis: ["60", "80", "100"],
      qual: "C",
      beleg: {
        typ: "angebot",
        extern: true,
        quellenangabe: "Angebot Strohhandel",
        erhebungsdatum: "2025-08-15",
        linkUrl: "https://example.org/angebot-stroh",
        gueltigBis: "2025-11-15",
      },
    },
    {
      bez: "Test: Grünschnitt Bauhof",
      akteur: "Kompostwerk Breisgau",
      mat: "gruenschnitt",
      ort: "Emmendingen",
      lk: "Emmendingen",
      lng: 7.85,
      lat: 48.12,
      roh: "1200",
      ts: "40",
      asche: "8",
      saison: ernte(),
      preis: ["10", "15", "22"],
      qual: "C",
      beleg: {
        typ: "gespraech",
        extern: true,
        quellenangabe: "Gespräch Bauhofleitung",
        erhebungsdatum: "2025-05-12",
        gespraechsdatum: "2025-05-12",
        gespraechspartner: "Herr Vogt",
      },
    },
    {
      bez: "Test: Gülle Nachbarhof",
      akteur: "Milchhof Alb",
      mat: "guelle",
      ort: "Laichingen",
      lk: "Alb-Donau-Kreis",
      lng: 9.68,
      lat: 48.49,
      roh: "1500",
      ts: "9",
      asche: "13",
      saison: gleich(),
      preis: ["1", "3", "5"],
      qual: "C",
      beleg: {
        typ: "dokument_link",
        extern: true,
        amtlich: false,
        quellenangabe: "Blog-Beitrag Hof",
        erhebungsdatum: "2025-06-01",
        linkUrl: "https://example.org/hof-notiz",
      },
    },
    {
      bez: "Test: Stroh Restposten",
      akteur: "Agrar Genossenschaft Donautal",
      mat: "stroh",
      ort: "Sinsheim",
      lk: "Rhein-Neckar-Kreis",
      lng: 8.88,
      lat: 49.25,
      roh: "800",
      ts: "85",
      asche: "6",
      saison: ernte(),
      preis: ["55", "70", "90"],
      qual: "D",
      beleg: {
        // Angebot ohne "extern nachvollziehbar" -> unvollstaendig -> D
        typ: "angebot",
        extern: false,
        quellenangabe: "mündliche Auskunft",
        erhebungsdatum: "2025-08-20",
        gueltigBis: "2025-10-20",
      },
    },
    {
      bez: "Test: Mist Kleinbetrieb",
      akteur: "Sägewerk Höllental",
      mat: "mist",
      ort: "Titisee-Neustadt",
      lk: "Breisgau-Hochschwarzwald",
      lng: 8.21,
      lat: 47.91,
      roh: "300",
      ts: "28",
      asche: "17",
      saison: gleich(),
      preis: ["4", "6", "9"],
      qual: "D",
      beleg: {
        // Gespraech ohne extern -> D
        typ: "gespraech",
        extern: false,
        quellenangabe: "Telefonat",
        erhebungsdatum: "2025-07-03",
        gespraechsdatum: "2025-07-03",
        gespraechspartner: "Frau Klein",
      },
    },
    {
      bez: "Test: Betriebsdaten unvollständig",
      akteur: "Bioenergie Kraichgau GmbH",
      mat: "bioabfall",
      ort: "Bretten",
      lk: "Karlsruhe",
      lng: 8.7,
      lat: 49.04,
      roh: "5000",
      ts: "33",
      asche: "20",
      saison: gleich(),
      preis: ["0", "0", "0"],
      qual: "B",
      beleg: {
        // betriebsdaten, aber extern=false -> unvollstaendig -> B
        typ: "betriebsdaten",
        extern: false,
        quellenangabe: "interne Schätzung",
        erhebungsdatum: "2025-03-15",
        dateiKey: `belege/preview/seed/${uuid()}.pdf`,
      },
    },
  ];

  console.log(`Lege ${stroeme.length} Biomasseströme an…`);
  for (const s of stroeme) {
    const belegId = await insertBeleg(s.beleg);
    await sql`
      insert into biomassestrom
        (akteur_id, materialart_code, bezeichnung, ort, landkreis, standort_geom,
         kontaktperson, menge_roh_fm, ts_anteil_pct, aschegehalt_pct,
         zeitraum_von, zeitraum_bis, saisonalitaet, preis_min, preis_mittel,
         preis_max, preis_herkunft, beleg_id, qualitaet, status)
      values
        (${A(s.akteur)}, ${s.mat}, ${s.bez}, ${s.ort}, ${s.lk},
         ST_SetSRID(ST_MakePoint(${s.lng}, ${s.lat}), 4326), ${"Ansprechpartner Test"},
         ${s.roh}, ${s.ts}, ${s.asche}, '2025-01-01', '2025-12-31',
         ${sql.json(s.saison)}, ${s.preis[0]}, ${s.preis[1]}, ${s.preis[2]},
         'schaetzung', ${belegId}, ${s.qual}, 'geprueft')`;
  }

  // --- Output-Bedarfe (verschiedene Vektoren, mit Standort) ---
  const bedarfe: Array<{
    bez: string;
    akteur: string;
    vektor: string;
    wert: string;
    einheit: string;
    ort: string;
    lk: string;
    lng: number;
    lat: number;
    qual: Grade | null;
    beleg?: BelegSpec;
  }> = [
    {
      bez: "Test: Nahwärmenetz Ortsmitte",
      akteur: "Bioenergie Kraichgau GmbH",
      vektor: "waerme",
      wert: "4200",
      einheit: "MWh/a",
      ort: "Bretten",
      lk: "Karlsruhe",
      lng: 8.71,
      lat: 49.03,
      qual: "A",
      beleg: {
        typ: "vertrag",
        extern: true,
        quellenangabe: "Wärmeliefervertrag",
        erhebungsdatum: "2025-02-01",
        dateiKey: `belege/preview/seed/${uuid()}.pdf`,
      },
    },
    {
      bez: "Test: H2-Bedarf Logistik",
      akteur: "Agrar Genossenschaft Donautal",
      vektor: "h2",
      wert: "120",
      einheit: "t/a",
      ort: "Ulm",
      lk: "Alb-Donau-Kreis",
      lng: 9.98,
      lat: 48.4,
      qual: "C",
      beleg: {
        typ: "angebot",
        extern: true,
        quellenangabe: "Angebot H2-Abnahme",
        erhebungsdatum: "2025-07-10",
        linkUrl: "https://example.org/h2-angebot",
        gueltigBis: "2025-10-10",
      },
    },
    {
      bez: "Test: CO2-Abnahme Gewächshaus",
      akteur: "Milchhof Alb",
      vektor: "co2",
      wert: "800",
      einheit: "t/a",
      ort: "Merklingen",
      lk: "Alb-Donau-Kreis",
      lng: 9.75,
      lat: 48.51,
      qual: "D",
      beleg: {
        typ: "gespraech",
        extern: false,
        quellenangabe: "Erstgespräch",
        erhebungsdatum: "2025-06-20",
        gespraechsdatum: "2025-06-20",
        gespraechspartner: "Herr Sauer",
      },
    },
    {
      bez: "Test: Prozesswärme Sägewerk",
      akteur: "Sägewerk Höllental",
      vektor: "waerme",
      wert: "1600",
      einheit: "MWh/a",
      ort: "Kirchzarten",
      lk: "Breisgau-Hochschwarzwald",
      lng: 8.06,
      lat: 47.97,
      qual: "B",
      beleg: {
        typ: "absichtserklaerung",
        extern: true,
        quellenangabe: "LOI Wärmenutzung",
        erhebungsdatum: "2025-03-30",
        dateiKey: `belege/preview/seed/${uuid()}.pdf`,
      },
    },
  ];

  console.log(`Lege ${bedarfe.length} Output-Bedarfe an…`);
  for (const b of bedarfe) {
    const belegId = b.beleg ? await insertBeleg(b.beleg) : null;
    await sql`
      insert into output_bedarf
        (akteur_id, bezeichnung, ort, landkreis, standort_geom, kontaktperson,
         vektor, menge_wert, menge_einheit, zeitraum_von, zeitraum_bis,
         saisonalitaet, beleg_id, qualitaet, status)
      values
        (${A(b.akteur)}, ${b.bez}, ${b.ort}, ${b.lk},
         ST_SetSRID(ST_MakePoint(${b.lng}, ${b.lat}), 4326), ${"Ansprechpartner Test"},
         ${b.vektor}, ${b.wert}, ${b.einheit}, '2025-01-01', '2025-12-31',
         ${sql.json(gleich())}, ${belegId}, ${b.qual}, 'geprueft')`;
  }

  console.log("Seed abgeschlossen.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
