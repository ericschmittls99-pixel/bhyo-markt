// Kennzahlen von auswertung. (AP1i PR 7) — reine Funktionen ueber Strom[],
// bewusst OHNE Datenbank-, Netzwerk- oder Uhrzeit-Zugriff (aktuellesJahr und
// heuteIso kommen als Parameter). Ersetzt die SQL-Aggregationen der V1
// (lib/auswertung.ts): der einzige Treiber-Kontakt bleibt der getestete
// PR-3-Pfad in stroeme-zeilen.ts; hier gibt es keine sql<T>-Behauptungen mehr.
// Die Fachregeln folgen dashVals() aus dem V2-Mockup.

import { energieKwh, preisEuroMwh, preisEuroT, STOFFLICHE_PRODUKTE } from "./energie";
import { jahresAnteil, type FensterKategorie } from "./fenster";
import type { VergabeDaten } from "./verfuegbarkeit";
import { CLUSTER_FARBE, CLUSTER_LABEL, OUTPUT_FARBE, OUTPUT_LABEL } from "./farben";
import { fmtDatum, fmtGeldGross, fmtMenge, fmtPreis } from "./format";
import { saisonZuIndex } from "./saison";
import { STATUS_LABEL } from "./status";
import { BELEG_LABEL, STATUS_REIHENFOLGE, type Strom, type StromArt } from "./stroeme-modell";
import { verifikationsFaelligkeit } from "./verifizierung";

export type Sicht = "feedstock" | "outputs";

export interface KpiKarte {
  wert: string;
  einheit: string;
  label: string;
  caption: string;
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
  /** Suffix hinter dem Wert, z. B. "(n=7 von 9)" oder "· ungewichtet". */
  zusatz?: string | null;
  /** Popover-/Caption-Text, z. B. "2 Belege, keine Menge im Bezugsjahr". */
  hinweis?: string | null;
  /** Fall C: kein ausweisbarer Wert — Zeile wird gedimmt dargestellt. */
  stumm?: boolean;
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

/** Zweigeteilte Output-Listen: energetisch (MWh/a bzw. €/MWh) und stofflich (t/a bzw. €/t). */
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
  /** Jahr liegt vor dem aktuellen — wird visuell als Vergangenheit abgegrenzt (E16). */
  vergangen: boolean;
  /** E16-Deckel: nur an der letzten Saeule gesetzt, wenn Belege darueber hinauslaufen. */
  ueberlaufBis: number | null;
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
  /** Suffix hinter dem ø-Wert, z. B. "(n=7 von 9)" oder "· ungewichtet". */
  zusatz: string | null;
  /** Popover-/Caption-Text, z. B. "2 Belege, keine Menge im Bezugsjahr". */
  hinweis: string | null;
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
const kwhVon = (s: Strom) =>
  energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit) ?? 0;
const istStofflich = (s: Strom) => STOFFLICHE_PRODUKTE.has(s.produktCode ?? "");
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const atroVon = (s: Strom) => s.mengeAtro ?? 0;
const nBelege = (n: number) => `${fmtMenge(n)} ${n === 1 ? "Beleg" : "Belege"}`;

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
    .map((u) => `${fmtMenge(je[u]!)} ${u}`)
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
 * Feedstock-Potenzial (E18, revidiert aus E14-Saldo): auf Beleg-Ebene bleibt
 * preis_* der signierte Zahlungsstrom aus Sicht bhyo (positiv = bhyo zahlt,
 * negativ = bhyo erhaelt Annahmeentgelt). Das POTENZIAL flippt das Vorzeichen
 * der Aggregation: positiv = Nettoerloes aus Verwertung (gut fuer bhyo),
 * negativ = Nettobeschaffungskosten. Spanne = Min/Max je Position,
 * mengengewichtet — beim Flip tauschen Min und Max die Seiten.
 */
function potenzialSumme(mitPreis: Strom[]) {
  const saldoMin = sum(mitPreis, (s) => (s.preisMin ?? s.preisMittel!) * atroVon(s));
  const saldoMax = sum(mitPreis, (s) => (s.preisMax ?? s.preisMittel!) * atroVon(s));
  return {
    min: -saldoMax,
    mittel: -sum(mitPreis, (s) => s.preisMittel! * atroVon(s)),
    max: -saldoMin,
  };
}

/** Kumulation (Summe im Zeitraum): /a aus der Einheit nehmen. */
function skaliereEinheit(
  kpi: { wert: string; einheit: string },
  einheitJahr: (u: string) => string,
): { wert: string; einheit: string } {
  return { wert: kpi.wert, einheit: einheitJahr(kpi.einheit) };
}

/**
 * Basis des atro-gewichteten ø-Preises — drei Faelle, sauber getrennt
 * (Eric, 22.09.2026). Entscheidend ist null gegen 0 bei mengeAtro:
 * null = atro-Menge nicht ableitbar (z. B. TS-Anteil fehlt),
 * 0 = Gewicht vorhanden, aber im Bezugsjahr auf 0 skaliert (wendeFensterAn).
 * Die beiden NIE zusammenfassen — ein stiller Rueckfall auf ungewichtet
 * zeigt sonst Preise, wo das Mengenmodul 0 ausweist (Guelle/Mist, 22.09.).
 * Eine gemeinsame Funktion fuer Korridor-Modul UND KPI-Kachel, damit die
 * beiden nicht wieder auseinanderlaufen koennen.
 */
type GewichtungsBasis<T> =
  | { fall: "gewichtet"; oe: (f: (t: T) => number) => number }
  | { fall: "ungewichtet"; oe: (f: (t: T) => number) => number }
  | { fall: "keine_menge"; n: number };

/** EINE Implementierung fuer Feedstock (atro) und Outputs (kWh) — zwei liefen auseinander. */
function gewichtungsBasis<T>(
  items: T[],
  gewichtVon: (t: T) => number | null,
): GewichtungsBasis<T> {
  const gewichtbar = items.filter((t) => (gewichtVon(t) ?? 0) > 0);
  if (gewichtbar.length) {
    const tw = gewichtbar.reduce((n, t) => n + gewichtVon(t)!, 0);
    return {
      fall: "gewichtet",
      oe: (f) => gewichtbar.reduce((n, t) => n + f(t) * gewichtVon(t)!, 0) / tw,
    };
  }
  if (items.every((t) => gewichtVon(t) == null))
    return { fall: "ungewichtet", oe: (f) => items.reduce((n, t) => n + f(t), 0) / items.length };
  // Mischfall null + 0: mindestens eine Position HAT ein Gewicht, im
  // Bezugsjahr ist alles 0 → Fall C, kein Preis. Kein Rueckfall.
  return { fall: "keine_menge", n: items.length };
}

function preisBasis(mitPreis: Strom[]): GewichtungsBasis<Strom> {
  return gewichtungsBasis(mitPreis, (s) => s.mengeAtro);
}

const HINWEIS_OHNE_ATRO = "für diese Positionen ist keine atro-Menge ableitbar";
const HINWEIS_OHNE_ENERGIE = "für diese Positionen ist keine Energiemenge ableitbar";
const hinweisKeineMenge = (n: number) => `${nBelege(n)}, keine Menge im Bezugsjahr`;

export function kpiKarten(
  recs: Strom[],
  sicht: Sicht,
  /** true = Summe im Zeitraum (Kumulation): Raten-Einheiten verlieren das /a. */
  kumuliert = false,
): KpiKarte[] {
  const { feed, out } = feedOut(recs);
  const atroSum = sum(feed, atroVon);
  const einheitJahr = (u: string) => (kumuliert ? u.replace(/\/a\b/g, "") : u);

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
      wert: fmtMenge(kwh / 1000),
      einheit: einheitJahr("MWh/a"),
      label: "energiebedarf.",
      // Review 22.09.: "Target-Outputs nach Hu" entfaellt; die
      // Heizwert-Warnung bleibt — fehlende Umrechnung scheitert laut.
      caption: [
        co2Tonnen > 0 ? `dazu ${fmtMenge(co2Tonnen)} t CO₂/a` : "",
        ohneHeizwert > 0 ? `${nBelege(ohneHeizwert)} ohne Heizwert` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  } else {
    // Artrein seit dem Wegfall des Alle-Tabs: in der Feedstock-Sicht gibt es
    // keine Output-Belege, ein Bedarfszusatz entfaellt.
    mengeKpi = {
      wert: fmtMenge(atroSum),
      einheit: einheitJahr("t atro/a"),
      label: "trockenmasse.",
      caption: `aus ${fmtMenge(sum(feed, (s) => s.mengeFm ?? 0))} ${einheitJahr("t FM/a")}`,
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
    // kwh bleibt null|0 unterschieden: null = kein Energieaequivalent
    // ableitbar, 0 = Menge im Bezugsjahr auf 0 skaliert (drei Faelle).
    const mitEur = out
      .filter((s) => s.kategorie === "target")
      .map((s) => ({
        eurMwh: preisEuroMwh(s.produktCode, s.preis, s.preisEinheit),
        kwh: energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit),
      }))
      .filter((x): x is { eurMwh: number; kwh: number | null } => x.eurMwh != null);
    const potenziale = out
      .map(potenzialEuro)
      .filter((v): v is number => v != null);
    const ohnePreis = out.filter((s) => s.preis == null).length;
    const ohnePreisNote = ohnePreis ? ` · ${nBelege(ohnePreis)} ohne Preis` : "";

    let preisKpi: KpiKarte;
    if (mitEur.length === 0) {
      preisKpi = { wert: "–", einheit: "", label: "ø preis.", caption: "keine Preise in der Auswahl" };
    } else {
      // Dieselben drei Faelle wie die Feedstock-Kachel (gewichtungsBasis).
      const basis = gewichtungsBasis(mitEur, (x) => x.kwh);
      if (basis.fall === "keine_menge") {
        preisKpi = { wert: "–", einheit: "", label: "ø preis.", caption: hinweisKeineMenge(basis.n) };
      } else {
        preisKpi = {
          wert: fmtPreis(basis.oe((x) => x.eurMwh)),
          einheit: "€/MWh",
          label: "ø preis.",
          caption:
            basis.fall === "ungewichtet"
              ? "ungewichtet · keine Energiemenge ableitbar"
              : "MWh-gewichtet über Target-Outputs",
        };
      }
    }

    const potenzialKpi: KpiKarte =
      potenziale.length === 0
        ? { wert: "–", einheit: "", label: "erlöspotenzial.", caption: "keine Preise in der Auswahl" }
        : {
            ...skaliereEinheit(fmtGeldGross(potenziale.reduce((a, b) => a + b, 0)), einheitJahr),
            label: "erlöspotenzial.",
            caption: `Preis × Menge${ohnePreisNote}`,
          };

    return [geprueftKpi, mengeKpi, preisKpi, potenzialKpi];
  }

  // Feedstock (E12/E18): Pruefquote, Menge, EIN signierter ø-Preis,
  // Potenzial — Belegzahl und Erfassungsgrad wandern in die auswahlZeile.
  const mitPreis = feed.filter((s) => s.preisMittel != null);
  const ohnePreis = feed.length - mitPreis.length;
  let preisKpi: KpiKarte;
  let potenzialKpi: KpiKarte;
  if (mitPreis.length === 0) {
    const keine = { wert: "–", einheit: "", caption: "keine Preise in der Auswahl" };
    preisKpi = { ...keine, label: "ø preis." };
    potenzialKpi = { ...keine, label: "feedstock-potenzial." };
  } else {
    // Dieselben drei Faelle wie preisKorridorZeilen (gemeinsame preisBasis),
    // damit Kachel und Modul nie verschiedene ø zeigen.
    const basis = preisBasis(mitPreis);
    if (basis.fall === "keine_menge") {
      preisKpi = { wert: "–", einheit: "", label: "ø preis.", caption: hinweisKeineMenge(basis.n) };
    } else {
      // Review 22.09.: Caption schlank — n-Angabe, Vorzeichen-Legende und
      // ohne-Preis-Zaehler entfallen hier.
      preisKpi = {
        wert: fmtPreis(basis.oe((s) => s.preisMittel!)),
        einheit: "€/t",
        label: "ø preis.",
        caption:
          basis.fall === "ungewichtet"
            ? "ungewichtet · keine atro-Menge ableitbar"
            : "atro-gewichtet",
      };
    }
    potenzialKpi = {
      ...skaliereEinheit(fmtGeldGross(potenzialSumme(mitPreis).mittel), einheitJahr),
      label: "feedstock-potenzial.",
      // Review 22.09.: nur der ohne-Preis-Zaehler bleibt.
      caption: ohnePreis ? `${nBelege(ohnePreis)} ohne Preis` : "",
    };
  }

  return [geprueftKpi, mengeKpi, preisKpi, potenzialKpi];
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
    wertText: feedMode ? fmtMenge(v) : nBelege(rs.length),
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
            wertText: fmtMenge(gv),
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

/**
 * Verteilung A-D ueber bewertete Stroeme; Donut und A+B-Quote bleiben auf
 * die bewerteten bezogen. E24: unbelegte Stroeme (qualitaet null) fallen
 * nicht mehr stumm raus — sie erscheinen als eigene Zeile "unbelegt"
 * (klickbarer Filterwert, pct bezogen auf ALLE Stroeme der Sicht).
 */
export function qualitaetsDaten(recs: Strom[]): QualitaetsDaten {
  const bewertet = recs.filter((s) => s.qualitaet != null);
  const unbelegt = recs.length - bewertet.length;
  const anzahl = (stufe: string) => bewertet.filter((s) => s.qualitaet === stufe).length;
  const stufen = ["A", "B", "C", "D"];
  return {
    segmente: stufen.map((stufe) => ({
      stufe,
      anteil: bewertet.length ? anzahl(stufe) / bewertet.length : 0,
    })),
    abProzent: pct(anzahl("A") + anzahl("B"), bewertet.length),
    zeilen: [
      ...stufen.map((stufe) => ({
        stufe,
        label: QUALITAET_BESCHREIBUNG[stufe]!,
        anzahl: anzahl(stufe),
        pct: pct(anzahl(stufe), bewertet.length),
      })),
      ...(unbelegt > 0
        ? [{
            stufe: "unbelegt",
            label: "ohne Beleg — keine Stufe",
            anzahl: unbelegt,
            pct: pct(unbelegt, recs.length),
          }]
        : []),
    ],
  };
}

export function statusZeilen(recs: Strom[]): StatusZeile[] {
  return STATUS_REIHENFOLGE.map((key) => {
    const n = recs.filter((s) => s.status === key).length;
    return { key, label: STATUS_LABEL[key] ?? key, anzahl: n, pct: pct(n, recs.length) };
  });
}

/**
 * Gewichteter Monatsindex; fehlende Saisonalitaet zaehlt flach 100.
 * Jeder Strom wird zuerst auf die Index-Skala normiert (saisonZuIndex) —
 * die gespeicherte Skala ist bedeutungslos (Alt-Bestand Summe 100, neu
 * Index um 100), roh gemischt wuerde ein Index-Profil ein Alt-Profil um
 * den Faktor 12 dominieren.
 */
function saisonIndex(rs: Strom[], gewicht: (s: Strom) => number): number[] {
  let tw = sum(rs, gewicht);
  let w = gewicht;
  if (tw === 0) {
    // Alle Gewichte 0 (z. B. Atro fehlt ueberall): gleichgewichtet statt Nullkurve.
    w = () => 1;
    tw = rs.length;
  }
  const indexVon = new Map(
    rs.map((s) => [s, s.saisonalitaet ? saisonZuIndex(s.saisonalitaet) : null]),
  );
  return Array.from({ length: 12 }, (_, m) =>
    tw ? Math.round(sum(rs, (s) => w(s) * (indexVon.get(s)?.[m] ?? 100)) / tw) : 0,
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

/**
 * Dynamische Jahresachse (E16, Eric 21.09.): lueckenlos vom fruehesten bis
 * zum spaetesten Jahr der Belegzeitraeume; ohne jeden Zeitraum faellt sie
 * aufs aktuelle Jahr zurueck. E16-Deckel (Review 22.09.2026): Ende bei
 * min(spaetestes Zeitraumende, aktuelles Jahr + 10) — eine einzelne
 * 2099-Eingabe erzeugt sonst 74 Saeulen; der Ueberlauf wird an der letzten
 * Saeule markiert. Ab ~8 Balken scrollt das Modul (CSS).
 */
function jahresAchse(
  recs: Strom[],
  aktuellesJahr: number,
): { achse: number[]; ueberlaufBis: number | null } {
  const jahre = recs.flatMap((s) =>
    [s.zeitraumVon, s.zeitraumBis]
      .filter((iso): iso is string => iso != null)
      .map((iso) => Number(iso.slice(0, 4))),
  );
  // Offene Zeitraeume (E17) starten ab dem aktuellen Jahr — das gehoert
  // dann auch auf die Achse, selbst wenn kein Beleg es explizit nennt.
  if (recs.some((s) => s.zeitraumVon == null || s.zeitraumBis == null))
    jahre.push(aktuellesJahr);
  const lo = jahre.length ? Math.min(...jahre) : aktuellesJahr;
  const hiRoh = jahre.length ? Math.max(...jahre) : aktuellesJahr;
  const hi = Math.min(hiRoh, aktuellesJahr + 10);
  return {
    achse: Array.from({ length: Math.max(0, hi - lo) + 1 }, (_, i) => lo + i),
    ueberlaufBis: hiRoh > hi ? hiRoh : null,
  };
}

/** Fuer die Jahr-Pillen der Seite: gedeckelte Achse aus dem Pool. */
export function poolJahresAchse(recs: Strom[], aktuellesJahr: number): number[] {
  return jahresAchse(recs, aktuellesJahr).achse;
}

/**
 * Jahres-Summe MONATSSCHARF (E19): Rate × Σ Saisonanteile der zaehlenden
 * Monate je Kalenderjahr, optional eingeschraenkt auf Fensterkategorien
 * (fensterbezogener Status-Filter). Erwartet UNSKALIERTE recs — die
 * Original-Jahresrate, nicht die Fenster-Menge.
 */
function jahresWerte(
  recs: Strom[],
  achse: number[],
  vergabenMap: Map<string, VergabeDaten[]>,
  kategorien: ReadonlySet<FensterKategorie> | null,
  wertVon: (s: Strom) => number,
): number[] {
  return achse.map((jahr) =>
    sum(
      recs,
      (s) => wertVon(s) * jahresAnteil(jahr, s, vergabenMap.get(s.id) ?? [], kategorien),
    ),
  );
}

function zuJahresBalken(
  achse: number[],
  werte: number[],
  aktuellesJahr: number,
  ueberlaufBis: number | null,
): JahresBalken[] {
  const max = Math.max(1, ...werte);
  return achse.map((jahr, i) => ({
    jahr,
    wertText: fmtMenge(Math.round(werte[i]!)),
    pct: Math.max(2, Math.round((werte[i]! / max) * 100)),
    aktuell: jahr === aktuellesJahr,
    vergangen: jahr < aktuellesJahr,
    ueberlaufBis: i === achse.length - 1 ? ueberlaufBis : null,
  }));
}

/** Feedstock: verfuegbare t atro je Jahr, monatsscharf auf gedeckelter Achse. */
export function jahresBalken(
  recs: Strom[],
  aktuellesJahr: number,
  vergabenMap: Map<string, VergabeDaten[]> = new Map(),
  kategorien: ReadonlySet<FensterKategorie> | null = null,
): JahresBalken[] {
  const feed = recs.filter((s) => s.art === "biomasse");
  const { achse, ueberlaufBis } = jahresAchse(feed, aktuellesJahr);
  return zuJahresBalken(
    achse,
    jahresWerte(feed, achse, vergabenMap, kategorien, atroVon),
    aktuellesJahr,
    ueberlaufBis,
  );
}

/**
 * Outputs (E13/E16): Bedarfe je Jahr — Energie = Target-Outputs in MWh/a
 * (ohne Waerme), Stofflich = CO2 + Asche in t/a. Beide Reihen teilen sich
 * eine Achse aus allen Output-Belegen, damit der Switch sie nicht verschiebt.
 */
export function outputJahre(
  recs: Strom[],
  aktuellesJahr: number,
  vergabenMap: Map<string, VergabeDaten[]> = new Map(),
  kategorien: ReadonlySet<FensterKategorie> | null = null,
): { energie: JahresBalken[]; stofflich: JahresBalken[] } {
  const out = recs.filter((s) => s.art === "output");
  const { achse, ueberlaufBis } = jahresAchse(out, aktuellesJahr);
  return {
    energie: zuJahresBalken(
      achse,
      jahresWerte(out.filter((s) => s.kategorie === "target"), achse, vergabenMap, kategorien, (s) => kwhVon(s) / 1000),
      aktuellesJahr,
      ueberlaufBis,
    ),
    stofflich: zuJahresBalken(
      achse,
      jahresWerte(out.filter(istStofflich), achse, vergabenMap, kategorien, (s) => s.mengeWert ?? 0),
      aktuellesJahr,
      ueberlaufBis,
    ),
  };
}

/**
 * Cluster-Zeilen mit Min/Mittel/Max auf gemeinsamer 0..Max-Skala (Bandbreite
 * als Korridor je Cluster). Keys aus dem Pool wie clusterZeilen, damit
 * gefilterte Zeilen sichtbar bleiben und nur dimmen.
 */
/** Ergebnis je Zeile: eine Spanne mit optionaler Kennzeichnung — oder bewusst leer (Fall C / keine Preise). */
type SpannenErgebnis =
  | { leer: false; min: number; mittel: number; max: number; zusatz: string | null; hinweis: string | null }
  | { leer: true; hinweis: string | null };

const mittelOderMinusInf = (sp: SpannenErgebnis) =>
  sp.leer ? Number.NEGATIVE_INFINITY : sp.mittel;

function clusterSpannen(
  pool: Strom[],
  recs: Strom[],
  spanneVon: (mitPreis: Strom[]) => SpannenErgebnis,
  fmt: (n: number) => string,
): SpannenZeile[] {
  const spanneAus = (rs: Strom[]): SpannenErgebnis => {
    const mitPreis = rs.filter((s) => s.preisMittel != null);
    return mitPreis.length ? spanneVon(mitPreis) : { leer: true, hinweis: null };
  };
  // Eine gemeinsame Skala fuer alle Cluster: exakt vom kleinsten Min bis
  // zum groessten Max ueber alle Zeilen (Eric, E18-Nachtrag) — kein
  // 0-Anker, die Baender nutzen die volle Breite.
  const felder = (sp: SpannenErgebnis, lo: number, hi: number) => {
    if (sp.leer)
      return {
        minText: "–",
        mittelText: "–",
        maxText: "–",
        vonPct: 0,
        mittelPct: 0,
        bisPct: 0,
        leer: true,
        zusatz: null,
        hinweis: sp.hinweis,
      };
    const anteil = (v: number) => Math.round(((v - lo) / (hi - lo)) * 100);
    return {
      minText: fmt(sp.min),
      mittelText: fmt(sp.mittel),
      maxText: fmt(sp.max),
      vonPct: anteil(sp.min),
      mittelPct: anteil(sp.mittel),
      bisPct: anteil(sp.max),
      leer: false,
      zusatz: sp.zusatz,
      hinweis: sp.hinweis,
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
  // Akkordeon: Materialarten des Clusters auf derselben Skala; ohne Preis
  // ans Ende (leer markiert), sonst nach Mittelwert absteigend.
  const unterje = keys.map((_, i) =>
    materialartGruppen(clusterPool[i]!, clusterRecs[i]!)
      .map((g) => ({ g, sp: spanneAus(g.rs) }))
      .sort(
        (a, b) =>
          mittelOderMinusInf(b.sp) - mittelOderMinusInf(a.sp) ||
          a.g.label.localeCompare(b.g.label, "de"),
      ),
  );
  // Die Skala umfasst neben den Cluster-Spannen auch jede Materialart —
  // bei gemischten Vorzeichen ragt eine Materialart sonst ueber die
  // Cluster-Summe hinaus und Band/oe-Punkt laufen aus der Spur.
  const belegt = [...spannen, ...unterje.flat().map((u) => u.sp)].filter(
    (sp): sp is Extract<SpannenErgebnis, { leer: false }> => !sp.leer,
  );
  const lo = belegt.length ? Math.min(...belegt.map((sp) => sp.min)) : 0;
  const hiRoh = belegt.length ? Math.max(...belegt.map((sp) => sp.max)) : 1;
  const hi = hiRoh === lo ? lo + 1 : hiRoh;
  return keys.map((k, i) => ({
    key: k,
    label: CLUSTER_LABEL[k] ?? k,
    orb: `/orbs/cluster/${k}.webp`,
    farbe: CLUSTER_FARBE[k] ?? "#b9c0bd",
    ...felder(spannen[i]!, lo, hi),
    unter: unterje[i]!.map(({ g, sp }) => ({ key: g.key, label: g.label, ...felder(sp, lo, hi) })),
  }));
}

/** Feedstock-Potenzial je Cluster (E18): -Σ Preis × t atro in €/a, Min/Max je Position. */
export function potenzialZeilen(pool: Strom[], recs: Strom[]): SpannenZeile[] {
  return clusterSpannen(
    pool,
    recs,
    (mitPreis) => ({ leer: false, ...potenzialSumme(mitPreis), zusatz: null, hinweis: null }),
    (n) => fmtMenge(Math.round(n)),
  );
}

/**
 * Preiskorridor je Cluster in €/t: Min/Mittel/Max je Position atro-
 * mengengewichtet (E14) — dieselbe Regel wie die Saldo-Spanne, nur als
 * ø statt Summe. Kein Konfidenzintervall. Die drei Faelle der
 * Gewichtungsbasis (gewichtet / ungewichtet / keine Menge im Bezugsjahr)
 * kommen aus preisBasis — identisch zur KPI-Kachel.
 */
export function preisKorridorZeilen(pool: Strom[], recs: Strom[]): SpannenZeile[] {
  return clusterSpannen(
    pool,
    recs,
    (mitPreis) => {
      const basis = preisBasis(mitPreis);
      if (basis.fall === "keine_menge")
        return { leer: true, hinweis: hinweisKeineMenge(basis.n) };
      return {
        leer: false,
        min: basis.oe((s) => s.preisMin ?? s.preisMittel!),
        mittel: basis.oe((s) => s.preisMittel!),
        max: basis.oe((s) => s.preisMax ?? s.preisMittel!),
        zusatz: basis.fall === "ungewichtet" ? "· ungewichtet" : null,
        hinweis: basis.fall === "ungewichtet" ? HINWEIS_OHNE_ATRO : null,
      };
    },
    fmtPreis,
  );
}

/**
 * Euro-Potenzial eines Output-Belegs: energetisch ueber €/MWh x MWh,
 * stofflich (CO2/Asche) ueber €/t x t/a. Null ohne umrechenbaren Preis.
 */
function potenzialEuro(s: Strom): number | null {
  if (istStofflich(s)) {
    const eurT = preisEuroT(s.preis, s.preisEinheit);
    if (eurT == null || s.mengeWert == null || s.mengeEinheit !== "t/a") return null;
    return eurT * s.mengeWert;
  }
  const eurMwh = preisEuroMwh(s.produktCode, s.preis, s.preisEinheit);
  const kwh = energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit);
  return eurMwh != null && kwh != null ? (eurMwh * kwh) / 1000 : null;
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
    energetisch: baue(defs.energetisch, (s) => kwhVon(s) / 1000, (v) => fmtMenge(Math.round(v))),
    stofflich: baue(
      defs.stofflich,
      (s) => (s.mengeEinheit === "t/a" ? (s.mengeWert ?? 0) : 0),
      (v) => fmtMenge(Math.round(v)),
    ),
  };
}

/**
 * erlöspotenzial je gruppe. (E13): Preis x Menge in €/a — zweigeteilt
 * energetisch/stofflich (Review 22.09.), eine gemeinsame Skala ueber beide
 * Sektionen.
 */
export function outputPotenzialZeilen(pool: Strom[], recs: Strom[]): OutputListen {
  const defs = outputRowDefs(pool);
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

  const zeilenVon = (ds: OutputRowDef[]) =>
    ds.map((d) => ({ d, ...wertUndMeta(outRecs.filter(d.passt)) }));
  const zeilenE = zeilenVon(defs.energetisch);
  const zeilenS = zeilenVon(defs.stofflich);
  const max = Math.max(1, ...[...zeilenE, ...zeilenS].map((z) => z.v ?? 0));
  const render = (zeilen: ReturnType<typeof zeilenVon>): OutputZeile[] =>
    zeilen.map(({ d, v, meta }) => ({
    facette: d.facette,
    key: d.key,
    label: d.label,
    orb: d.orb,
    farbe: d.farbe,
    pct: v == null ? 0 : Math.round((v / max) * 100),
    wertText: v == null ? "–" : fmtMenge(Math.round(v)),
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
              wertText: gv == null ? "–" : fmtMenge(Math.round(gv)),
              meta: gMeta,
            }))
        : [],
  }));
  return { energetisch: render(zeilenE), stofflich: render(zeilenS) };
}

/**
 * preise je gruppe. (E13/E20): energetische Zeilen als MWh-gewichteter ø in
 * €/MWh, stoffliche als ø €/t — je Sektion eine Basiseinheit.
 */
export function outputPreisZeilen(pool: Strom[], recs: Strom[]): OutputListen {
  const defs = outputRowDefs(pool);
  const outPool = pool.filter((s) => s.art === "output");
  const outRecs = recs.filter((s) => s.art === "output");

  /** ø-Ergebnis einer Zeile inkl. der Drei-Faelle-Kennzeichnung. */
  type PreisWert = { v: number | null; zusatz: string | null; hinweis: string | null; stumm: boolean };
  const wert = (v: number | null, zusatz: string | null = null, hinweis: string | null = null, stumm = false): PreisWert =>
    ({ v, zusatz, hinweis, stumm });

  // Energetisch: dieselben drei Faelle wie die ø-Preis-Kachel, ueber
  // dieselbe gewichtungsBasis. kwh: null = kein Energieaequivalent
  // ableitbar, 0 = Menge im Bezugsjahr auf 0 skaliert — nie zusammenfassen.
  const euroMwhMittel = (rs: Strom[]): PreisWert => {
    const mitEurMwh = rs
      .map((s) => ({
        eurMwh: preisEuroMwh(s.produktCode, s.preis, s.preisEinheit),
        kwh: energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit),
      }))
      .filter((x): x is { eurMwh: number; kwh: number | null } => x.eurMwh != null);
    if (!mitEurMwh.length) return wert(null);
    const basis = gewichtungsBasis(mitEurMwh, (x) => x.kwh);
    if (basis.fall === "keine_menge")
      return wert(null, null, hinweisKeineMenge(basis.n), true);
    return wert(
      basis.oe((x) => x.eurMwh),
      basis.fall === "ungewichtet" ? "· ungewichtet" : null,
      basis.fall === "ungewichtet" ? HINWEIS_OHNE_ENERGIE : null,
    );
  };
  const euroTMittel = (rs: Strom[]): PreisWert => {
    const werte = rs
      .map((s) => preisEuroT(s.preis, s.preisEinheit))
      .filter((v): v is number => v != null);
    return wert(werte.length ? werte.reduce((a, b) => a + b, 0) / werte.length : null);
  };

  const baue = (ds: OutputRowDef[], mittel: (rs: Strom[]) => PreisWert): OutputZeile[] => {
    const zeilen = ds.map((d) => {
      const rs = outRecs.filter(d.passt);
      const ohne = rs.filter((s) => s.preis == null).length;
      return {
        d,
        w: mittel(rs),
        meta: nBelege(rs.length) + (ohne ? ` · ${nBelege(ohne)} ohne Preis` : ""),
      };
    });
    const max = Math.max(...zeilen.map((z) => z.w.v ?? 0), 0.01);
    return zeilen.map(({ d, w, meta }) => ({
      facette: d.facette,
      key: d.key,
      label: d.label,
      orb: d.orb,
      farbe: d.farbe,
      pct: w.v == null ? 0 : Math.round((w.v / max) * 100),
      wertText: w.v == null ? "–" : fmtPreis(w.v),
      zusatz: w.zusatz,
      hinweis: w.hinweis,
      stumm: w.stumm,
      meta,
      unter:
        d.facette === "gruppe"
          ? produktGruppen(outPool.filter(d.passt), outRecs.filter(d.passt))
              .map((g) => ({ g, w: mittel(g.rs) }))
              .sort((a, b) => (b.w.v ?? -1) - (a.w.v ?? -1) || a.g.label.localeCompare(b.g.label, "de"))
              .map(({ g, w: gw }) => ({
                key: g.key,
                label: g.label,
                pct: gw.v == null ? 0 : Math.round((gw.v / max) * 100),
                wertText: gw.v == null ? "–" : fmtPreis(gw.v),
                zusatz: gw.zusatz,
                hinweis: gw.hinweis,
                stumm: gw.stumm,
                meta: nBelege(g.rs.length),
              }))
          : [],
    }));
  };

  return {
    energetisch: baue(defs.energetisch, euroMwhMittel),
    stofflich: baue(defs.stofflich, euroTMittel),
  };
}

export function verifZeilen(
  recs: Strom[],
  heuteIso: string,
  /** Vergaben je Strom (AP1j PR 5): koppelt die Faelligkeit an Ablaufdaten. */
  vergabenMap: Map<string, VergabeDaten[]> = new Map(),
): VerifZeile[] {
  return recs
    .flatMap((s) => {
      const datum = verifikationsFaelligkeit(
        s.beleg,
        s,
        vergabenMap.get(s.id) ?? [],
      );
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
      sub: [
        s.materialartLabel ?? s.produktLabel,
        s.beleg ? (BELEG_LABEL[s.beleg.typ] ?? s.beleg.typ) : "ohne Beleg",
      ]
        .filter(Boolean)
        .join(" · "),
      datum: fmtDatum(datum),
      ueberfaellig: datum < heuteIso,
    }));
}
