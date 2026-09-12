// Kennzahlen von auswertung. (AP1i PR 7) — reine Funktionen ueber Strom[],
// bewusst OHNE Datenbank-, Netzwerk- oder Uhrzeit-Zugriff (aktuellesJahr und
// heuteIso kommen als Parameter). Ersetzt die SQL-Aggregationen der V1
// (lib/auswertung.ts): der einzige Treiber-Kontakt bleibt der getestete
// PR-3-Pfad in stroeme-zeilen.ts; hier gibt es keine sql<T>-Behauptungen mehr.
// Die Fachregeln folgen dashVals() aus dem V2-Mockup.

import { energieKwh, preisCtKwh, preisEuroKg } from "./energie";
import { CLUSTER_FARBE, CLUSTER_LABEL, OUTPUT_FARBE, OUTPUT_LABEL } from "./farben";
import { fmtDatum, fmtPreis, fmtZahl } from "./format";
import { STATUS_LABEL } from "./status";
import { BELEG_LABEL, STATUS_REIHENFOLGE, type Strom, type StromArt } from "./stroeme-modell";
import { naechsteVerifizierung } from "./verifizierung";

export type Sicht = "feedstock" | "outputs";

export interface KpiKarte {
  wert: string;
  einheit: string;
  label: string;
  caption: string;
}

export interface ClusterZeile {
  key: string;
  label: string;
  orb: string;
  farbe: string;
  pct: number;
  wertText: string;
  meta: string;
}

export interface QualitaetsDaten {
  segmente: { stufe: string; anteil: number }[];
  abProzent: number;
  zeilen: { stufe: string; label: string; anzahl: number }[];
}

export interface StatusZeile {
  key: string;
  label: string;
  anzahl: number;
  pct: number;
}

export interface SaisonDaten {
  feed: number[] | null;
  out: number[] | null;
  feedPeak: number;
  outPeak: number;
  notiz: string;
}

export interface BelegtypZeile {
  key: string;
  label: string;
  anzahl: number;
  pct: number;
}

export interface JahresBalken {
  jahr: number;
  wertText: string;
  pct: number;
  aktuell: boolean;
}

export interface PreisDaten {
  stats: { wert: string; einheit: string; label: string }[];
  korridor: { minText: string; maxText: string; pos: number } | null;
}

export interface VerifZeile {
  id: string;
  art: StromArt;
  orb: string;
  titel: string;
  sub: string;
  datum: string;
  ueberfaellig: boolean;
}

const sum = (arr: Strom[], fn: (s: Strom) => number) =>
  arr.reduce((n, s) => n + fn(s), 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const atroVon = (s: Strom) => s.mengeAtro ?? 0;
const nBelege = (n: number) => `${fmtZahl(n)} ${n === 1 ? "Beleg" : "Belege"}`;

function feedOut(recs: Strom[]) {
  return {
    feed: recs.filter((s) => s.art === "biomasse"),
    out: recs.filter((s) => s.art === "output"),
  };
}

/** Bedarfssummen je Einheit ("500 MWh/a · 120 t/a"). */
function einheitenText(out: Strom[]): string {
  const je: Record<string, number> = {};
  for (const s of out) {
    if (s.mengeWert == null || !s.mengeEinheit) continue;
    je[s.mengeEinheit] = (je[s.mengeEinheit] ?? 0) + s.mengeWert;
  }
  return Object.keys(je)
    .map((u) => `${fmtZahl(je[u]!)} ${u}`)
    .join(" · ");
}

export function kpiKarten(recs: Strom[], sicht: Sicht): KpiKarte[] {
  const { feed, out } = feedOut(recs);
  const atroSum = sum(feed, atroVon);

  let mengeKpi: KpiKarte;
  if (sicht === "outputs") {
    // Energiebedarf = Hu-Aequivalent der Target-Outputs (lib/energie);
    // CO2 ist stofflich und steht separat daneben. Belege ohne belegbaren
    // Heizwert (Synthesegas/BioFuels in t/a, fehlende Menge) werden
    // ausgewiesen statt still ignoriert.
    const targets = out.filter((s) => s.kategorie === "target");
    const kwh = sum(
      targets,
      (s) => energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit) ?? 0,
    );
    const ohneHeizwert = targets.filter(
      (s) => energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit) == null,
    ).length;
    const co2Tonnen = sum(
      out.filter((s) => s.produktCode === "co2" && s.mengeEinheit === "t/a"),
      (s) => s.mengeWert ?? 0,
    );
    mengeKpi = {
      wert: fmtZahl(kwh / 1000),
      einheit: "MWh/a",
      label: "energiebedarf.",
      caption: [
        "Target-Outputs nach Hu",
        co2Tonnen > 0 ? `dazu ${fmtZahl(co2Tonnen)} t CO2/a` : "",
        ohneHeizwert > 0 ? `${nBelege(ohneHeizwert)} ohne Heizwert` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  } else {
    const bedarf = einheitenText(out);
    mengeKpi = {
      wert: fmtZahl(atroSum),
      einheit: "t atro/a",
      label: "trockenmasse.",
      caption:
        `aus ${fmtZahl(sum(feed, (s) => s.mengeFm ?? 0))} t FM/a` +
        (bedarf ? ` · Bedarf ${bedarf}` : ""),
    };
  }

  const geprueft = recs.filter((s) => s.status === "geprueft").length;
  const inPruefung = recs.filter((s) => s.status === "in_pruefung").length;
  const avg = recs.length
    ? Math.round(sum(recs, (s) => s.vollstaendigkeit) / recs.length)
    : 0;
  const niedrig = recs.filter((s) => s.vollstaendigkeit < 50).length;

  // Caption: vertretene Cluster bzw. Output-Gruppen (seit dem Wegfall des
  // Alle-Tabs ist die Auswahl immer artrein — Feedstock/Outputs zu zaehlen
  // waere redundant zum Wert).
  const gruppenAnzahl = new Set(
    (sicht === "outputs" ? out : feed)
      .map((s) => (s.art === "biomasse" ? s.cluster : s.gruppe))
      .filter(Boolean),
  ).size;
  const gruppenCaption =
    sicht === "outputs"
      ? `${gruppenAnzahl} ${gruppenAnzahl === 1 ? "Output-Gruppe" : "Output-Gruppen"}`
      : `${gruppenAnzahl} Cluster`;

  return [
    {
      wert: fmtZahl(recs.length),
      einheit: recs.length === 1 ? "Beleg" : "Belege",
      label: "in der auswahl.",
      caption: gruppenCaption,
    },
    mengeKpi,
    {
      wert: String(pct(geprueft, recs.length)),
      einheit: "%",
      label: "belege geprüft.",
      caption: `${geprueft} von ${recs.length} · ${inPruefung} in Prüfung`,
    },
    {
      wert: String(avg),
      einheit: "%",
      label: "ø erfassungsgrad.",
      caption: niedrig ? `${nBelege(niedrig)} unter 50 %` : "alle Belege über 50 %",
    },
  ];
}

/**
 * Zeilen "biomasse je cluster." bzw. "belege je output-gruppe.": die Keys
 * kommen aus dem POOL (ungefilterte Sicht), die Werte aus der Auswahl — so
 * bleiben Zeilen beim Klick-Filtern sichtbar und dimmen nur (Mockup rowSt).
 */
export function clusterZeilen(pool: Strom[], recs: Strom[], sicht: Sicht): ClusterZeile[] {
  const feedMode = sicht !== "outputs";
  const alleKeys = feedMode ? Object.keys(CLUSTER_LABEL) : Object.keys(OUTPUT_LABEL);
  const keyVon = (s: Strom) => (s.art === "biomasse" ? s.cluster : s.gruppe);
  const keys = alleKeys.filter((k) => pool.some((s) => keyVon(s) === k));
  const { feed } = feedOut(recs);
  const atroSum = sum(feed, atroVon);

  const werte = keys.map((k) => {
    const rs = recs.filter((s) => keyVon(s) === k);
    return { k, rs, v: feedMode ? sum(rs.filter((s) => s.art === "biomasse"), atroVon) : rs.length };
  });
  const max = Math.max(1, ...werte.map((w) => w.v));

  return werte.map(({ k, rs, v }) => ({
    key: k,
    label: feedMode ? (CLUSTER_LABEL[k] ?? k) : (OUTPUT_LABEL[k] ?? k),
    orb: feedMode
      ? `/orbs/cluster/${k}.webp`
      : `/orbs/output/${k === "add_ons" ? "waerme" : k}.webp`,
    farbe: (feedMode ? CLUSTER_FARBE[k] : OUTPUT_FARBE[k]) ?? "#b9c0bd",
    pct: Math.round((v / max) * 100),
    wertText: feedMode ? fmtZahl(v) : nBelege(rs.length),
    meta: feedMode
      ? `${nBelege(rs.length)} · ${pct(v, atroSum)} %`
      : einheitenText(rs),
  }));
}

// Beschreibungen je Qualitaetsstufe (Mockup; die Stufe wird abgeleitet, nie gewaehlt).
const QUALITAET_BESCHREIBUNG: Record<string, string> = {
  A: "Vertrag, Betriebsdaten · extern belegt",
  B: "belastbar, teils intern",
  C: "Angebot, Gespräch · belegt",
  D: "nur intern, nicht belegt",
};

/** Verteilung A-D nur ueber bewertete Stroeme (unbewertete fallen raus — Mockup-Luecke, im PR-Text). */
export function qualitaetsDaten(recs: Strom[]): QualitaetsDaten {
  const bewertet = recs.filter((s) => s.qualitaet != null);
  const anzahl = (stufe: string) => bewertet.filter((s) => s.qualitaet === stufe).length;
  const stufen = ["A", "B", "C", "D"];
  return {
    segmente: stufen.map((stufe) => ({
      stufe,
      anteil: bewertet.length ? anzahl(stufe) / bewertet.length : 0,
    })),
    abProzent: pct(anzahl("A") + anzahl("B"), bewertet.length),
    zeilen: stufen.map((stufe) => ({
      stufe,
      label: QUALITAET_BESCHREIBUNG[stufe]!,
      anzahl: anzahl(stufe),
    })),
  };
}

export function statusZeilen(recs: Strom[]): StatusZeile[] {
  return STATUS_REIHENFOLGE.map((key) => {
    const n = recs.filter((s) => s.status === key).length;
    return { key, label: STATUS_LABEL[key] ?? key, anzahl: n, pct: pct(n, recs.length) };
  });
}

const MONAT_NAMEN = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
];

/** Gewichteter Monatsindex; fehlende Saisonalitaet zaehlt flach 100. */
function saisonIndex(rs: Strom[], gewicht: (s: Strom) => number): number[] {
  let tw = sum(rs, gewicht);
  let w = gewicht;
  if (tw === 0) {
    // Alle Gewichte 0 (z. B. Atro fehlt ueberall): gleichgewichtet statt Nullkurve.
    w = () => 1;
    tw = rs.length;
  }
  return Array.from({ length: 12 }, (_, m) =>
    tw ? Math.round(sum(rs, (s) => w(s) * (s.saisonalitaet?.[m] ?? 100)) / tw) : 0,
  );
}

const peakIdx = (v: number[]) => v.indexOf(Math.max(...v));

export function saisonDaten(recs: Strom[]): SaisonDaten {
  const { feed, out } = feedOut(recs);
  const feedIdx = feed.length ? saisonIndex(feed, atroVon) : null;
  const outIdx = out.length ? saisonIndex(out, () => 1) : null;
  return {
    feed: feedIdx,
    out: outIdx,
    feedPeak: feedIdx ? peakIdx(feedIdx) : 0,
    outPeak: outIdx ? peakIdx(outIdx) : 0,
    notiz: [
      feedIdx ? `Angebotsspitze im ${MONAT_NAMEN[peakIdx(feedIdx)]}` : "",
      outIdx ? `Bedarfsspitze im ${MONAT_NAMEN[peakIdx(outIdx)]}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function belegtypZeilen(recs: Strom[]): BelegtypZeile[] {
  const zeilen = Object.keys(BELEG_LABEL).map((key) => ({
    key,
    label: BELEG_LABEL[key]!,
    anzahl: recs.filter((s) => s.beleg?.typ === key).length,
    pct: 0,
  }));
  const max = Math.max(1, ...zeilen.map((z) => z.anzahl));
  for (const z of zeilen) z.pct = Math.round((z.anzahl / max) * 100);
  return zeilen;
}

const JAHRE = [2026, 2027, 2028, 2029, 2030, 2031];

export function jahresBalken(recs: Strom[], sicht: Sicht, aktuellesJahr: number): JahresBalken[] {
  const feedMode = sicht !== "outputs";
  const jahrVon = (iso: string | null, fallback: number) =>
    iso ? Number(iso.slice(0, 4)) : fallback;
  const werte = JAHRE.map((jahr) => {
    const rs = recs.filter(
      (s) =>
        jahrVon(s.zeitraumVon, JAHRE[0]!) <= jahr &&
        jahrVon(s.zeitraumBis, JAHRE[JAHRE.length - 1]!) >= jahr,
    );
    return feedMode ? sum(rs.filter((s) => s.art === "biomasse"), atroVon) : rs.length;
  });
  const max = Math.max(1, ...werte);
  return JAHRE.map((jahr, i) => ({
    jahr,
    wertText: fmtZahl(werte[i]!),
    pct: Math.max(2, Math.round((werte[i]! / max) * 100)),
    aktuell: jahr === aktuellesJahr,
  }));
}

export function preisDaten(recs: Strom[], sicht: Sicht): PreisDaten {
  const { feed, out } = feedOut(recs);
  const feedMode = sicht !== "outputs";

  if (feedMode) {
    const mitPreis = feed.filter((s) => s.preisMittel != null);
    if (!mitPreis.length) return { stats: [], korridor: null };
    let tw = sum(mitPreis, atroVon);
    let w = atroVon;
    if (tw === 0) {
      w = () => 1;
      tw = mitPreis.length;
    }
    const mittel = Math.round(sum(mitPreis, (s) => s.preisMittel! * w(s)) / tw);
    const minWerte = feed.map((s) => s.preisMin).filter((v): v is number => v != null);
    const maxWerte = feed.map((s) => s.preisMax).filter((v): v is number => v != null);
    const min = minWerte.length ? Math.min(...minWerte) : null;
    const max = maxWerte.length ? Math.max(...maxWerte) : null;
    return {
      stats: [{ wert: fmtPreis(mittel), einheit: "€/t", label: "ø preis, gewichtet nach t atro/a." }],
      korridor:
        min != null && max != null
          ? {
              minText: fmtPreis(min),
              maxText: fmtPreis(max),
              pos: max > min ? Math.min(100, Math.max(0, Math.round(((mittel - min) / (max - min)) * 100))) : 50,
            }
          : null,
    };
  }

  // Outputs (Review-Runde 3 Eric): drei getrennte Kennzahlen — Targets und
  // Waerme als ct/kWh (Umrechnung ueber Hu, lib/energie), CO2 als €/kg.
  // Belege ohne umrechenbaren Preis fallen aus der jeweiligen Gruppe.
  const stats: PreisDaten["stats"] = [];
  const runde2 = (x: number) => Math.round(x * 100) / 100;

  const targetPreise = out
    .filter((s) => s.kategorie === "target")
    .map((s) => ({
      ct: preisCtKwh(s.produktCode, s.preis, s.preisEinheit),
      kwh: energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit) ?? 0,
    }))
    .filter((x): x is { ct: number; kwh: number } => x.ct != null);
  if (targetPreise.length) {
    let tw = targetPreise.reduce((n, x) => n + x.kwh, 0);
    let gewicht = (x: { kwh: number }) => x.kwh;
    if (tw === 0) {
      gewicht = () => 1;
      tw = targetPreise.length;
    }
    const mittel = targetPreise.reduce((n, x) => n + x.ct * gewicht(x), 0) / tw;
    stats.push({
      wert: fmtPreis(runde2(mittel)),
      einheit: "ct/kWh",
      label: "ø preis target-outputs, kWh-gewichtet.",
    });
  }

  const waermePreise = out
    .filter((s) => s.produktCode === "waerme")
    .map((s) => preisCtKwh(s.produktCode, s.preis, s.preisEinheit))
    .filter((v): v is number => v != null);
  if (waermePreise.length) {
    stats.push({
      wert: fmtPreis(runde2(waermePreise.reduce((a, b) => a + b, 0) / waermePreise.length)),
      einheit: "ct/kWh",
      label: "ø preis wärme.",
    });
  }

  const co2Preise = out
    .filter((s) => s.produktCode === "co2")
    .map((s) => preisEuroKg(s.preis, s.preisEinheit))
    .filter((v): v is number => v != null);
  if (co2Preise.length) {
    stats.push({
      wert: fmtPreis(runde2(co2Preise.reduce((a, b) => a + b, 0) / co2Preise.length)),
      einheit: "€/kg",
      label: "ø preis CO2.",
    });
  }

  return { stats, korridor: null };
}

export function verifZeilen(recs: Strom[], heuteIso: string): VerifZeile[] {
  return recs
    .flatMap((s) => {
      if (!s.beleg) return [];
      const datum = naechsteVerifizierung(s.beleg);
      return datum ? [{ s, datum }] : [];
    })
    .sort((a, b) => (a.datum < b.datum ? -1 : 1))
    .slice(0, 3)
    .map(({ s, datum }) => ({
      id: s.id,
      art: s.art,
      orb:
        s.art === "biomasse"
          ? `/orbs/cluster/${s.cluster ?? "organische_rest_abfallstoffe"}.webp`
          : s.gruppe === "add_ons" && s.produktCode
            ? `/orbs/output/${s.produktCode}.webp`
            : `/orbs/output/${s.gruppe ?? "primaerprodukte"}.webp`,
      titel: s.akteurName ?? s.bezeichnung ?? "–",
      sub: [s.materialartLabel ?? s.produktLabel, BELEG_LABEL[s.beleg!.typ] ?? s.beleg!.typ]
        .filter(Boolean)
        .join(" · "),
      datum: fmtDatum(datum),
      ueberfaellig: datum < heuteIso,
    }));
}
