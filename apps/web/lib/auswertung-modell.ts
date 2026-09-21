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

export interface KpiStat {
  wert: string;
  einheit: string;
  label: string;
}

export interface KpiKarte {
  wert: string;
  einheit: string;
  label: string;
  caption: string;
  /** Ersetzt den grossen Einzelwert durch mehrere kleine Stats (ø-Preise, E14). */
  stats?: KpiStat[];
  /** Erlaeuterungstext fuer ein Info-Popover (Feedstock-Saldo, E14). */
  hinweis?: string;
}

/** Akkordeon-Unterzeile je Materialart; key leer = kein Code, nicht filterbar. */
export interface MaterialartZeile {
  key: string;
  label: string;
  pct: number;
  wertText: string;
  meta: string;
}

export interface ClusterZeile {
  key: string;
  label: string;
  orb: string;
  farbe: string;
  pct: number;
  wertText: string;
  meta: string;
  unter: MaterialartZeile[];
}

export interface QualitaetsDaten {
  segmente: { stufe: string; anteil: number }[];
  abProzent: number;
  zeilen: { stufe: string; label: string; anzahl: number; pct: number }[];
}

export interface StatusZeile {
  key: string;
  label: string;
  anzahl: number;
  pct: number;
}

export interface SaisonDaten {
  feed: number[] | null;
  outEnergie: number[] | null;
  outStofflich: number[] | null;
}

/** Akkordeon-Unterzeile eines Output-Moduls (ein Produkt). */
export interface OutputUnterzeile {
  key: string;
  label: string;
  pct: number;
  wertText: string;
  meta: string;
}

/**
 * Zeile der Output-Module (E13-Umbau): Gruppen filtern die gruppe-Facette,
 * Einzelprodukte (Waerme, CO2, Asche) die produkt-Facette.
 */
export interface OutputZeile extends OutputUnterzeile {
  facette: "gruppe" | "produkt";
  orb: string;
  farbe: string;
  unter: OutputUnterzeile[];
}

/** Zweigeteilte Output-Listen: energetisch (MWh/a bzw. ct/kWh) und stofflich (t/a bzw. €/kg). */
export interface OutputListen {
  energetisch: OutputZeile[];
  stofflich: OutputZeile[];
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

export interface SpannenUnterzeile {
  key: string;
  label: string;
  minText: string;
  mittelText: string;
  maxText: string;
  vonPct: number;
  mittelPct: number;
  bisPct: number;
  leer: boolean;
}

export interface SpannenZeile extends SpannenUnterzeile {
  orb: string;
  farbe: string;
  unter: SpannenUnterzeile[];
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
const STOFFLICH = new Set(["co2", "asche"]);
const kwhVon = (s: Strom) =>
  energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit) ?? 0;
const istStofflich = (s: Strom) => STOFFLICH.has(s.produktCode ?? "");
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

/**
 * Auswahl-Zeile ueber den Kacheln (Feedstock-Umbau Eric 21.09.): Belegzahl und
 * Erfassungsgrad ruecken aus den KPI-Kacheln in eine schmale Caption.
 */
export function auswahlZeile(recs: Strom[]): string {
  const avg = recs.length
    ? Math.round(sum(recs, (s) => s.vollstaendigkeit) / recs.length)
    : 0;
  return `${nBelege(recs.length)} in der Auswahl (ø Erfassungsgrad ${avg} %)`;
}

/**
 * Feedstock-Saldo = Σ Preis × Menge (E14): preis_* ist der signierte
 * Zahlungsstrom aus Sicht bhyo (positiv = bhyo zahlt, negativ = bhyo
 * erhaelt). Die Spanne summiert Min/Max je Position (Rueckfall auf
 * preisMittel) — mengengewichtet, kein Konfidenzintervall.
 */
function saldoSumme(mitPreis: Strom[]) {
  return {
    min: sum(mitPreis, (s) => (s.preisMin ?? s.preisMittel!) * atroVon(s)),
    mittel: sum(mitPreis, (s) => s.preisMittel! * atroVon(s)),
    max: sum(mitPreis, (s) => (s.preisMax ?? s.preisMittel!) * atroVon(s)),
  };
}

/** Anzeige-Skalierung ab |1 Mio| auf Mio. €/a, Vorzeichen bleibt sichtbar. */
function saldoWert(v: number): { wert: string; einheit: string } {
  return Math.abs(v) >= 1_000_000
    ? { wert: fmtPreis(Math.round(v / 10_000) / 100), einheit: "Mio. €/a" }
    : { wert: fmtZahl(Math.round(v)), einheit: "€/a" };
}

export const SALDO_HINWEIS =
  "Zahlungsstrom aus Sicht bhyo: positiv = Nettobeschaffungskosten (bhyo zahlt), " +
  "negativ = Nettoerlös aus Annahme (bhyo erhält Annahme-/Entsorgungsentgelte).";

/** Atro-gewichtetes Preismittel; ohne Atro-Gewichte gleichgewichtet. */
function preisMittelGewichtet(mitPreis: Strom[]): number {
  let tw = sum(mitPreis, atroVon);
  let w = atroVon;
  if (tw === 0) {
    w = () => 1;
    tw = mitPreis.length;
  }
  return Math.round(sum(mitPreis, (s) => s.preisMittel! * w(s)) / tw);
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
    // Artrein seit dem Wegfall des Alle-Tabs: in der Feedstock-Sicht gibt es
    // keine Output-Belege, ein Bedarfszusatz entfaellt.
    mengeKpi = {
      wert: fmtZahl(atroSum),
      einheit: "t atro/a",
      label: "trockenmasse.",
      caption: `aus ${fmtZahl(sum(feed, (s) => s.mengeFm ?? 0))} t FM/a`,
    };
  }

  const geprueft = recs.filter((s) => s.status === "geprueft").length;
  const inPruefung = recs.filter((s) => s.status === "in_pruefung").length;
  const geprueftKpi: KpiKarte = {
    wert: String(pct(geprueft, recs.length)),
    einheit: "%",
    label: "belege geprüft.",
    caption: `${geprueft} von ${recs.length} · ${inPruefung} in Prüfung`,
  };

  if (sicht === "outputs") {
    // Outputs-Umbau (E13, Eric 21.09.): Kacheln wie beim Feedstock-Board —
    // Pruefquote, Energiebedarf, kWh-gewichteter ø Preis, Potenzial in €/a.
    // Nur Target-Outputs (Eric 21.09.): Waerme fliesst nicht in den ø Preis.
    const mitCt = out
      .filter((s) => s.kategorie === "target")
      .map((s) => ({
        ct: preisCtKwh(s.produktCode, s.preis, s.preisEinheit),
        kwh: kwhVon(s),
      }))
      .filter((x): x is { ct: number; kwh: number } => x.ct != null);
    const potenziale = out
      .map(potenzialEuro)
      .filter((v): v is number => v != null);
    const ohnePreis = out.filter((s) => s.preis == null).length;
    const ohnePreisNote = ohnePreis ? ` · ${nBelege(ohnePreis)} ohne Preis` : "";

    let preisKpi: KpiKarte;
    if (mitCt.length === 0) {
      preisKpi = { wert: "–", einheit: "", label: "ø preis.", caption: "keine Preise in der Auswahl" };
    } else {
      let tw = mitCt.reduce((n, x) => n + x.kwh, 0);
      let gewicht = (x: { kwh: number }) => x.kwh;
      if (tw === 0) {
        gewicht = () => 1;
        tw = mitCt.length;
      }
      const mittel = mitCt.reduce((n, x) => n + x.ct * gewicht(x), 0) / tw;
      preisKpi = {
        wert: fmtPreis(Math.round(mittel * 100) / 100),
        einheit: "ct/kWh",
        label: "ø preis.",
        caption: `kWh-gewichtet über Target-Outputs${ohnePreisNote}`,
      };
    }

    const potenzialKpi: KpiKarte =
      potenziale.length === 0
        ? { wert: "–", einheit: "", label: "erlöspotenzial.", caption: "keine Preise in der Auswahl" }
        : {
            ...saldoWert(potenziale.reduce((a, b) => a + b, 0)),
            label: "erlöspotenzial.",
            caption: `Preis × Menge${ohnePreisNote}`,
          };

    return [geprueftKpi, mengeKpi, preisKpi, potenzialKpi];
  }

  // Feedstock (E12/E14): Pruefquote, Menge, getrennte ø-Preise, Saldo —
  // Belegzahl und Erfassungsgrad wandern in die auswahlZeile. Ein gemischter
  // ø ueber beide Vorzeichen laege nahe null und waere bedeutungslos, darum
  // Einkaufspreise (>= 0) und Annahmeentgelte (< 0) getrennt.
  const mitPreis = feed.filter((s) => s.preisMittel != null);
  const ohnePreis = feed.length - mitPreis.length;
  const ohneNote = ohnePreis ? ` · ${nBelege(ohnePreis)} ohne Preis` : "";
  let preisKpi: KpiKarte;
  let saldoKpi: KpiKarte;
  if (mitPreis.length === 0) {
    const keine = { wert: "–", einheit: "", caption: "keine Preise in der Auswahl" };
    preisKpi = { ...keine, label: "ø preise." };
    saldoKpi = { ...keine, label: "feedstock-saldo.", hinweis: SALDO_HINWEIS };
  } else {
    const einkauf = mitPreis.filter((s) => s.preisMittel! >= 0);
    const annahme = mitPreis.filter((s) => s.preisMittel! < 0);
    const stats: KpiStat[] = [];
    if (einkauf.length)
      stats.push({
        wert: fmtPreis(preisMittelGewichtet(einkauf)),
        einheit: "€/t",
        label: `ø einkaufspreis (n=${einkauf.length})`,
      });
    if (annahme.length)
      stats.push({
        wert: fmtPreis(-preisMittelGewichtet(annahme)),
        einheit: "€/t",
        label: `ø annahmeentgelt (n=${annahme.length})`,
      });
    preisKpi = {
      wert: "",
      einheit: "",
      label: "ø preise.",
      caption: `atro-gewichtet${ohneNote}`,
      stats,
    };
    const s = saldoSumme(mitPreis);
    saldoKpi = {
      ...saldoWert(s.mittel),
      label: "feedstock-saldo.",
      caption: `Spanne ${fmtZahl(Math.round(s.min))} – ${fmtZahl(Math.round(s.max))} €/a · Min/Max je Position, mengengewichtet`,
      hinweis: SALDO_HINWEIS,
    };
  }

  return [geprueftKpi, mengeKpi, preisKpi, saldoKpi];
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
    unter: feedMode
      ? materialartGruppen(
          pool.filter((s) => s.art === "biomasse" && keyVon(s) === k),
          rs.filter((s) => s.art === "biomasse"),
        )
          .map((g) => ({ g, v: sum(g.rs, atroVon) }))
          .sort((a, b) => b.v - a.v || a.g.label.localeCompare(b.g.label, "de"))
          .map(({ g, v: gv }) => ({
            key: g.key,
            label: g.label,
            pct: Math.round((gv / max) * 100),
            wertText: fmtZahl(gv),
            meta: nBelege(g.rs.length),
          }))
      : [],
  }));
}

/**
 * Gruppiert Feedstock-Belege nach Materialart (Akkordeon-Unterzeilen).
 * Gruppiert wird ueber Code oder ersatzweise Label; filterbar (key) ist nur,
 * was einen materialart_code traegt — die Facette filtert ueber den Code.
 * Wie bei den Cluster-Zeilen kommen die Gruppen aus dem POOL und die Werte
 * aus der Auswahl, damit gefilterte Zeilen sichtbar bleiben und nur dimmen.
 */
function materialartGruppen(
  poolRs: Strom[],
  recsRs: Strom[],
): { key: string; label: string; rs: Strom[] }[] {
  const gkVon = (s: Strom) => s.materialartCode ?? s.materialartLabel ?? "";
  const je = new Map<string, { key: string; label: string; rs: Strom[] }>();
  for (const s of poolRs) {
    const gk = gkVon(s);
    if (!je.has(gk))
      je.set(gk, {
        key: s.materialartCode ?? "",
        label: s.materialartLabel ?? "ohne Materialart",
        rs: [],
      });
  }
  for (const s of recsRs) je.get(gkVon(s))?.rs.push(s);
  return [...je.values()];
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
      pct: pct(anzahl(stufe), bewertet.length),
    })),
  };
}

export function statusZeilen(recs: Strom[]): StatusZeile[] {
  return STATUS_REIHENFOLGE.map((key) => {
    const n = recs.filter((s) => s.status === key).length;
    return { key, label: STATUS_LABEL[key] ?? key, anzahl: n, pct: pct(n, recs.length) };
  });
}

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

export function saisonDaten(recs: Strom[]): SaisonDaten {
  const { feed, out } = feedOut(recs);
  // Outputs (E13): Energie = Target-Outputs kWh-gewichtet (Waerme zaehlt
  // nicht), Stofflich = CO2 + Asche t-gewichtet.
  const targets = out.filter((s) => s.kategorie === "target");
  const stofflich = out.filter(istStofflich);
  return {
    feed: feed.length ? saisonIndex(feed, atroVon) : null,
    outEnergie: targets.length ? saisonIndex(targets, kwhVon) : null,
    outStofflich: stofflich.length
      ? saisonIndex(stofflich, (s) => s.mengeWert ?? 0)
      : null,
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

/** Jahres-Summe je Kalenderjahr des Zeitraums; offene Zeitraeume zaehlen durchgehend. */
function jahresWerte(recs: Strom[], wertVon: (s: Strom) => number): number[] {
  const jahrVon = (iso: string | null, fallback: number) =>
    iso ? Number(iso.slice(0, 4)) : fallback;
  return JAHRE.map((jahr) =>
    sum(
      recs.filter(
        (s) =>
          jahrVon(s.zeitraumVon, JAHRE[0]!) <= jahr &&
          jahrVon(s.zeitraumBis, JAHRE[JAHRE.length - 1]!) >= jahr,
      ),
      wertVon,
    ),
  );
}

function zuJahresBalken(werte: number[], aktuellesJahr: number): JahresBalken[] {
  const max = Math.max(1, ...werte);
  return JAHRE.map((jahr, i) => ({
    jahr,
    wertText: fmtZahl(Math.round(werte[i]!)),
    pct: Math.max(2, Math.round((werte[i]! / max) * 100)),
    aktuell: jahr === aktuellesJahr,
  }));
}

/** Feedstock: verfuegbare t atro je Jahr. */
export function jahresBalken(recs: Strom[], aktuellesJahr: number): JahresBalken[] {
  return zuJahresBalken(
    jahresWerte(recs.filter((s) => s.art === "biomasse"), atroVon),
    aktuellesJahr,
  );
}

/**
 * Outputs (E13): Bedarfe je Jahr — Energie = Target-Outputs in MWh/a (ohne
 * Waerme), Stofflich = CO2 + Asche in t/a. Gleicher Switch wie Saisonalitaet.
 */
export function outputJahre(
  recs: Strom[],
  aktuellesJahr: number,
): { energie: JahresBalken[]; stofflich: JahresBalken[] } {
  const out = recs.filter((s) => s.art === "output");
  return {
    energie: zuJahresBalken(
      jahresWerte(out.filter((s) => s.kategorie === "target"), (s) => kwhVon(s) / 1000),
      aktuellesJahr,
    ),
    stofflich: zuJahresBalken(
      jahresWerte(out.filter(istStofflich), (s) => s.mengeWert ?? 0),
      aktuellesJahr,
    ),
  };
}

/**
 * Cluster-Zeilen mit Min/Mittel/Max auf gemeinsamer 0..Max-Skala (Bandbreite
 * als Korridor je Cluster). Keys aus dem Pool wie clusterZeilen, damit
 * gefilterte Zeilen sichtbar bleiben und nur dimmen.
 */
function clusterSpannen(
  pool: Strom[],
  recs: Strom[],
  spanneVon: (mitPreis: Strom[]) => { min: number; mittel: number; max: number },
  fmt: (n: number) => string,
): SpannenZeile[] {
  type Spanne = { min: number; mittel: number; max: number } | null;
  const spanneAus = (rs: Strom[]): Spanne => {
    const mitPreis = rs.filter((s) => s.preisMittel != null);
    return mitPreis.length ? spanneVon(mitPreis) : null;
  };
  // Skala ueber alle Zeilen; mit E14 koennen Salden/Preise negativ sein,
  // daher spannt sie von min(0, kleinstes Min) bis zum groessten Max.
  const felder = (sp: Spanne, lo: number, hi: number) => {
    const anteil = (v: number) => Math.round(((v - lo) / (hi - lo)) * 100);
    return {
      minText: sp ? fmt(sp.min) : "–",
      mittelText: sp ? fmt(sp.mittel) : "–",
      maxText: sp ? fmt(sp.max) : "–",
      vonPct: sp ? anteil(sp.min) : 0,
      mittelPct: sp ? anteil(sp.mittel) : 0,
      bisPct: sp ? anteil(sp.max) : 0,
      leer: !sp,
    };
  };

  const keys = Object.keys(CLUSTER_LABEL).filter((k) =>
    pool.some((s) => s.cluster === k),
  );
  const clusterPool = keys.map((k) =>
    pool.filter((s) => s.art === "biomasse" && s.cluster === k),
  );
  const clusterRecs = keys.map((k) =>
    recs.filter((s) => s.art === "biomasse" && s.cluster === k),
  );
  const spannen = clusterRecs.map(spanneAus);
  const lo = Math.min(0, ...spannen.map((sp) => sp?.min ?? 0));
  const hi = Math.max(lo + 1, ...spannen.map((sp) => sp?.max ?? 0));
  return keys.map((k, i) => ({
    key: k,
    label: CLUSTER_LABEL[k] ?? k,
    orb: `/orbs/cluster/${k}.webp`,
    farbe: CLUSTER_FARBE[k] ?? "#b9c0bd",
    ...felder(spannen[i] ?? null, lo, hi),
    // Akkordeon: Materialarten des Clusters auf derselben Skala; ohne Preis
    // ans Ende (leer markiert), sonst nach Mittelwert absteigend.
    unter: materialartGruppen(clusterPool[i]!, clusterRecs[i]!)
      .map((g) => ({ g, sp: spanneAus(g.rs) }))
      .sort(
        (a, b) =>
          (b.sp?.mittel ?? -1) - (a.sp?.mittel ?? -1) ||
          a.g.label.localeCompare(b.g.label, "de"),
      )
      .map(({ g, sp }) => ({ key: g.key, label: g.label, ...felder(sp, lo, hi) })),
  }));
}

/** Feedstock-Saldo je Cluster (E14): Σ Preis × t atro in €/a, Min/Max je Position. */
export function saldoZeilen(pool: Strom[], recs: Strom[]): SpannenZeile[] {
  return clusterSpannen(pool, recs, saldoSumme, (n) => fmtZahl(Math.round(n)));
}

/**
 * Preiskorridor je Cluster in €/t: Min/Mittel/Max je Position atro-
 * mengengewichtet (E14) — dieselbe Regel wie die Saldo-Spanne, nur als
 * ø statt Summe. Kein Konfidenzintervall.
 */
export function preisKorridorZeilen(pool: Strom[], recs: Strom[]): SpannenZeile[] {
  return clusterSpannen(
    pool,
    recs,
    (mitPreis) => {
      let tw = sum(mitPreis, atroVon);
      let w = atroVon;
      if (tw === 0) {
        w = () => 1;
        tw = mitPreis.length;
      }
      const gewichtet = (f: (s: Strom) => number) =>
        sum(mitPreis, (s) => f(s) * w(s)) / tw;
      return {
        min: gewichtet((s) => s.preisMin ?? s.preisMittel!),
        mittel: Math.round(gewichtet((s) => s.preisMittel!)),
        max: gewichtet((s) => s.preisMax ?? s.preisMittel!),
      };
    },
    fmtPreis,
  );
}

/**
 * Euro-Potenzial eines Output-Belegs: energetisch ueber ct/kWh x kWh,
 * stofflich (CO2/Asche) ueber €/kg x kg. Null ohne umrechenbaren Preis.
 */
function potenzialEuro(s: Strom): number | null {
  if (istStofflich(s)) {
    const eurKg = preisEuroKg(s.preis, s.preisEinheit);
    if (eurKg == null || s.mengeWert == null || s.mengeEinheit !== "t/a") return null;
    return eurKg * s.mengeWert * 1000;
  }
  const ct = preisCtKwh(s.produktCode, s.preis, s.preisEinheit);
  const kwh = energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit);
  return ct != null && kwh != null ? (ct * kwh) / 100 : null;
}

/** Zeilengerueste der Output-Module: energetisch (Gruppen + Waerme) und stofflich (CO2, Asche). */
interface OutputRowDef {
  facette: "gruppe" | "produkt";
  key: string;
  label: string;
  orb: string;
  farbe: string;
  passt: (s: Strom) => boolean;
}

function outputRowDefs(pool: Strom[]): { energetisch: OutputRowDef[]; stofflich: OutputRowDef[] } {
  const out = pool.filter((s) => s.art === "output");
  const energetisch: OutputRowDef[] = [];
  for (const g of Object.keys(OUTPUT_LABEL)) {
    if (g === "add_ons") continue;
    if (out.some((s) => s.gruppe === g))
      energetisch.push({
        facette: "gruppe",
        key: g,
        label: OUTPUT_LABEL[g] ?? g,
        orb: `/orbs/output/${g}.webp`,
        farbe: OUTPUT_FARBE[g] ?? "#b9c0bd",
        passt: (s) => s.art === "output" && s.gruppe === g,
      });
  }
  const produktDef = (code: string): OutputRowDef | null => {
    const b = out.find((s) => s.produktCode === code);
    return b
      ? {
          facette: "produkt",
          key: code,
          label: b.produktLabel ?? code,
          orb: `/orbs/output/${code}.webp`,
          farbe: OUTPUT_FARBE.add_ons ?? "#b9c0bd",
          passt: (s) => s.art === "output" && s.produktCode === code,
        }
      : null;
  };
  const waerme = produktDef("waerme");
  if (waerme) energetisch.push(waerme);
  return {
    energetisch,
    stofflich: [produktDef("co2"), produktDef("asche")].filter(
      (d): d is OutputRowDef => d != null,
    ),
  };
}

/** Produkt-Gruppen einer Output-Gruppe (Akkordeon); Keys aus dem Pool, Werte aus der Auswahl. */
function produktGruppen(
  poolRs: Strom[],
  recsRs: Strom[],
): { key: string; label: string; rs: Strom[] }[] {
  const je = new Map<string, { key: string; label: string; rs: Strom[] }>();
  for (const s of poolRs) {
    const k = s.produktCode ?? "";
    if (!je.has(k)) je.set(k, { key: k, label: s.produktLabel ?? "ohne Produkt", rs: [] });
  }
  for (const s of recsRs) je.get(s.produktCode ?? "")?.rs.push(s);
  return [...je.values()];
}

const runde2 = (x: number) => Math.round(x * 100) / 100;

/**
 * bedarf je gruppe. (E13): energetische Zeilen in MWh/a (Targets nach Hu +
 * Waerme), stoffliche in t/a (CO2, Asche). Produkt-Akkordeon je Gruppe.
 */
export function outputMengen(pool: Strom[], recs: Strom[]): OutputListen {
  const defs = outputRowDefs(pool);
  const outPool = pool.filter((s) => s.art === "output");
  const outRecs = recs.filter((s) => s.art === "output");

  const baue = (
    ds: OutputRowDef[],
    wertVon: (s: Strom) => number,
    text: (v: number) => string,
  ): OutputZeile[] => {
    const werte = ds.map((d) => sum(outRecs.filter(d.passt), wertVon));
    const max = Math.max(1, ...werte);
    return ds.map((d, i) => ({
      facette: d.facette,
      key: d.key,
      label: d.label,
      orb: d.orb,
      farbe: d.farbe,
      pct: Math.round((werte[i]! / max) * 100),
      wertText: text(werte[i]!),
      meta: nBelege(outRecs.filter(d.passt).length),
      unter:
        d.facette === "gruppe"
          ? produktGruppen(outPool.filter(d.passt), outRecs.filter(d.passt))
              .map((g) => ({ g, v: sum(g.rs, wertVon) }))
              .sort((a, b) => b.v - a.v || a.g.label.localeCompare(b.g.label, "de"))
              .map(({ g, v }) => ({
                key: g.key,
                label: g.label,
                pct: Math.round((v / max) * 100),
                wertText: text(v),
                meta: nBelege(g.rs.length),
              }))
          : [],
    }));
  };

  return {
    energetisch: baue(defs.energetisch, (s) => kwhVon(s) / 1000, (v) => fmtZahl(Math.round(v))),
    stofflich: baue(
      defs.stofflich,
      (s) => (s.mengeEinheit === "t/a" ? (s.mengeWert ?? 0) : 0),
      (v) => fmtZahl(Math.round(v)),
    ),
  };
}

/** regionenpotenzial je gruppe. (E13): Preis x Menge in €/a, eine gemeinsame Skala. */
export function outputPotenzialZeilen(pool: Strom[], recs: Strom[]): OutputZeile[] {
  const defs = outputRowDefs(pool);
  const ds = [...defs.energetisch, ...defs.stofflich];
  const outPool = pool.filter((s) => s.art === "output");
  const outRecs = recs.filter((s) => s.art === "output");

  const wertUndMeta = (rs: Strom[]) => {
    const werte = rs.map(potenzialEuro).filter((v): v is number => v != null);
    const ohne = rs.filter((s) => potenzialEuro(s) == null).length;
    return {
      v: werte.length ? werte.reduce((a, b) => a + b, 0) : null,
      meta: nBelege(rs.length) + (ohne ? ` · ${nBelege(ohne)} ohne Preis` : ""),
    };
  };

  const zeilen = ds.map((d) => ({ d, ...wertUndMeta(outRecs.filter(d.passt)) }));
  const max = Math.max(1, ...zeilen.map((z) => z.v ?? 0));
  return zeilen.map(({ d, v, meta }) => ({
    facette: d.facette,
    key: d.key,
    label: d.label,
    orb: d.orb,
    farbe: d.farbe,
    pct: v == null ? 0 : Math.round((v / max) * 100),
    wertText: v == null ? "–" : fmtZahl(Math.round(v)),
    meta,
    unter:
      d.facette === "gruppe"
        ? produktGruppen(outPool.filter(d.passt), outRecs.filter(d.passt))
            .map((g) => ({ g, ...wertUndMeta(g.rs) }))
            .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || a.g.label.localeCompare(b.g.label, "de"))
            .map(({ g, v: gv, meta: gMeta }) => ({
              key: g.key,
              label: g.label,
              pct: gv == null ? 0 : Math.round((gv / max) * 100),
              wertText: gv == null ? "–" : fmtZahl(Math.round(gv)),
              meta: gMeta,
            }))
        : [],
  }));
}

/**
 * preise je gruppe. (E13): energetische Zeilen als kWh-gewichteter ø in
 * ct/kWh, stoffliche als ø €/kg — je Sektion eine Basiseinheit.
 */
export function outputPreisZeilen(pool: Strom[], recs: Strom[]): OutputListen {
  const defs = outputRowDefs(pool);
  const outPool = pool.filter((s) => s.art === "output");
  const outRecs = recs.filter((s) => s.art === "output");

  const ctMittel = (rs: Strom[]): number | null => {
    const mitCt = rs
      .map((s) => ({ ct: preisCtKwh(s.produktCode, s.preis, s.preisEinheit), kwh: kwhVon(s) }))
      .filter((x): x is { ct: number; kwh: number } => x.ct != null);
    if (!mitCt.length) return null;
    let tw = mitCt.reduce((n, x) => n + x.kwh, 0);
    let gewicht = (x: { kwh: number }) => x.kwh;
    if (tw === 0) {
      gewicht = () => 1;
      tw = mitCt.length;
    }
    return runde2(mitCt.reduce((n, x) => n + x.ct * gewicht(x), 0) / tw);
  };
  const kgMittel = (rs: Strom[]): number | null => {
    const werte = rs
      .map((s) => preisEuroKg(s.preis, s.preisEinheit))
      .filter((v): v is number => v != null);
    return werte.length ? runde2(werte.reduce((a, b) => a + b, 0) / werte.length) : null;
  };

  const baue = (ds: OutputRowDef[], mittel: (rs: Strom[]) => number | null): OutputZeile[] => {
    const zeilen = ds.map((d) => {
      const rs = outRecs.filter(d.passt);
      const ohne = rs.filter((s) => s.preis == null).length;
      return {
        d,
        v: mittel(rs),
        meta: nBelege(rs.length) + (ohne ? ` · ${nBelege(ohne)} ohne Preis` : ""),
      };
    });
    const max = Math.max(...zeilen.map((z) => z.v ?? 0), 0.01);
    return zeilen.map(({ d, v, meta }) => ({
      facette: d.facette,
      key: d.key,
      label: d.label,
      orb: d.orb,
      farbe: d.farbe,
      pct: v == null ? 0 : Math.round((v / max) * 100),
      wertText: v == null ? "–" : fmtPreis(v),
      meta,
      unter:
        d.facette === "gruppe"
          ? produktGruppen(outPool.filter(d.passt), outRecs.filter(d.passt))
              .map((g) => ({ g, v: mittel(g.rs) }))
              .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || a.g.label.localeCompare(b.g.label, "de"))
              .map(({ g, v: gv }) => ({
                key: g.key,
                label: g.label,
                pct: gv == null ? 0 : Math.round((gv / max) * 100),
                wertText: gv == null ? "–" : fmtPreis(gv),
                meta: nBelege(g.rs.length),
              }))
          : [],
    }));
  };

  return {
    energetisch: baue(defs.energetisch, ctMittel),
    stofflich: baue(defs.stofflich, kgMittel),
  };
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
