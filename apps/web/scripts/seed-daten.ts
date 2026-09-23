/**
 * Purer, deterministischer Daten-Generator fuer den Preview-Seed v2
 * (Auftrag Eric, 22.09.2026). KEIN Datenbank-, Netzwerk- oder Uhrzeit-
 * Zugriff; BASIS_JAHR und SEED sind Konstanten — zwei Laeufe erzeugen
 * bytegleiche Daten inklusive der IDs.
 *
 * Die Spec-Invarianten (Anzahlen, Klassen, Ankerfaelle) sind in
 * seed-daten.test.ts festgeschrieben; der Writer (seed-preview.ts) prueft
 * sie nach dem Insert nochmals aus der Datenbank.
 *
 * Dokumentierte Spec-Abweichungen (Stammdaten nicht geraten):
 * - Pflanzenkohle ist kein bhyo-Output (Beschluss 22.09.2026, der feste
 *   Rueckstand des Prozesses ist Asche) -> die 6 urspruenglichen Spec-Slots
 *   sind umverteilt auf +3 CO2, +2 Synthesegas, +1 Asche.
 * - CO2 ist per Referenztabelle add_on (stofflich, E13), nicht "target".
 */

import { deriveQualitaet } from "../lib/qualitaet";

/**
 * E23: Belegfelder, die die gewuenschte Zielstufe tatsaechlich ERZEUGEN —
 * die Stufe selbst wird nirgends gespeichert, sie entsteht als
 * GENERATED-Spalte in der DB. Ohne echte R2-Dateien laufen alle Stufen
 * ueber linkUrl (seed.invalid = klar synthetisch):
 *   A: betriebsdaten vollstaendig (extern + Quelle + Link)
 *   B: vertrag nur mit Link (ohne Dateiablage faellt er von A auf B)
 *   C: angebot vollstaendig (Link + gueltig_bis)
 *   D: gespraech ohne Gespraechsfelder, nicht extern nachvollziehbar
 * Die Selbstpruefung gegen deriveQualitaet bricht LAUT ab, wenn die Felder
 * die Zielstufe verfehlen — kein stiller Ersatzwert (Handoff-Regel).
 */
function belegFuerZiel(
  ziel: "A" | "B" | "C" | "D",
  quellenangabe: string,
  erhebungsdatum: string,
  linkNr: number,
): SeedBeleg {
  const linkUrl = `https://seed.invalid/beleg/${linkNr}`;
  const b: SeedBeleg =
    ziel === "A"
      ? { typ: "betriebsdaten", extern: true, erhebungsdatum, quellenangabe, linkUrl, gueltigBis: null }
      : ziel === "B"
        ? { typ: "vertrag", extern: true, erhebungsdatum, quellenangabe, linkUrl, gueltigBis: null }
        : ziel === "C"
          ? { typ: "angebot", extern: true, erhebungsdatum, quellenangabe, linkUrl, gueltigBis: `${BASIS_JAHR + 1}-12-31` }
          : { typ: "gespraech", extern: false, erhebungsdatum, quellenangabe, linkUrl: null, gueltigBis: null };
  const abgeleitet = deriveQualitaet({
    typ: b.typ as never,
    externNachvollziehbar: b.extern,
    erhebungsdatum: b.erhebungsdatum,
    linkUrl: b.linkUrl,
    gueltigBis: b.gueltigBis,
    metadata: { quellenangabe: b.quellenangabe },
  });
  if (abgeleitet !== ziel)
    throw new Error(
      `Seed-Belegfelder verfehlen die Zielstufe: gewollt ${ziel}, abgeleitet ${abgeleitet} (typ ${b.typ}).`,
    );
  return b;
}

export const SEED = 20260922;
export const BASIS_JAHR = 2026;
/** Nur fuer die Status-AUSGABE der Selbstpruefung — nie fuer die Daten. */
export const STICHTAG = `${BASIS_JAHR}-09-22`;
export const MARKER = " · SEED-v2";

const B = BASIS_JAHR;

export interface SeedVergabe {
  vergebenVon: string | null;
  vergebenBis: string | null;
  vergebenAn: string | null;
  anBhyo: boolean;
}

export interface SeedStrom {
  id: string;
  belegId: string | null;
  akteurIndex: number;
  art: "biomasse" | "output";
  bezeichnung: string;
  ort: string;
  /** F0b: null = Strom ohne Koordinate (Ankerfall A16g). */
  lng: number | null;
  lat: number | null;
  materialartCode?: string;
  mengeRohFm?: number;
  tsAnteilPct?: number;
  aschegehaltPct?: number;
  produktCode?: string;
  mengeWert?: number;
  mengeEinheit?: string;
  preisMin?: number | null;
  preisMittel?: number | null;
  preisMax?: number | null;
  preis?: number | null;
  preisEinheit?: string | null;
  zeitraumVon: string;
  zeitraumBis: string;
  /** 12 Werte, Summe 100 ± 0,1 — seit dem Index-Umbau (23.09.2026) ist die Skala frei; Summe-100-Profile sind als Index weiter gueltig (nur Verhaeltnisse zaehlen). */
  saisonalitaet: number[];
  // E23: KEIN Stufenwert im Seed-Input — die Stufe entsteht ausschliesslich
  // in der DB (GENERATED-Spalte auf beleg). Der Seed setzt nur Belegfelder;
  // seed-preview.ts bricht laut ab, wenn hier je wieder eine Stufe auftaucht.
  status: "entwurf" | "in_pruefung" | "geprueft";
  reserviertBhyo: boolean;
  reserviertSeit: string | null;
  vergaben: SeedVergabe[];
  beleg: null | SeedBeleg;
  anker?: string;
}

export interface SeedBeleg {
  typ: string;
  extern: boolean;
  erhebungsdatum: string;
  quellenangabe: string;
  linkUrl: string | null;
  gueltigBis: string | null;
}

export interface SeedAkteur {
  id: string;
  name: string;
  sektor: string;
}

// --- PRNG (mulberry32) -------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Orte (Naeherungen, Rhein-Neckar / Vorderpfalz / Odenwald / Kraichgau) ----

const ORTE: [string, string, number, number][] = [
  ["Speyer", "Rhein-Pfalz-Kreis", 8.43, 49.32],
  ["Ludwigshafen", "Ludwigshafen", 8.44, 49.48],
  ["Frankenthal", "Frankenthal", 8.35, 49.53],
  ["Worms", "Worms", 8.36, 49.63],
  ["Landau", "Südliche Weinstraße", 8.12, 49.2],
  ["Neustadt a. d. W.", "Neustadt", 8.14, 49.35],
  ["Bad Dürkheim", "Bad Dürkheim", 8.17, 49.46],
  ["Grünstadt", "Bad Dürkheim", 8.17, 49.57],
  ["Heidelberg", "Rhein-Neckar-Kreis", 8.69, 49.41],
  ["Mannheim", "Mannheim", 8.47, 49.49],
  ["Weinheim", "Rhein-Neckar-Kreis", 8.67, 49.55],
  ["Sinsheim", "Rhein-Neckar-Kreis", 8.88, 49.25],
  ["Wiesloch", "Rhein-Neckar-Kreis", 8.7, 49.29],
  ["Bruchsal", "Karlsruhe", 8.6, 49.12],
  ["Eppingen", "Heilbronn", 8.91, 49.14],
  ["Mosbach", "Neckar-Odenwald-Kreis", 9.15, 49.35],
  ["Eberbach", "Rhein-Neckar-Kreis", 8.99, 49.47],
  ["Buchen", "Neckar-Odenwald-Kreis", 9.32, 49.52],
  ["Walldürn", "Neckar-Odenwald-Kreis", 9.37, 49.58],
  ["Hockenheim", "Rhein-Neckar-Kreis", 8.55, 49.32],
  ["Schwetzingen", "Rhein-Neckar-Kreis", 8.57, 49.38],
  ["Germersheim", "Germersheim", 8.37, 49.22],
  ["Haßloch", "Bad Dürkheim", 8.26, 49.36],
  ["Schifferstadt", "Rhein-Pfalz-Kreis", 8.38, 49.39],
];

// --- Saisonprofile (Prozent, Summe 100) ---------------------------------------

// Exakt 100 statt der 99,6 der Formular-Gleichverteilung: Spec §4 verlangt
// Saison-Summe 1 (±0,001); der letzte Monat traegt die Rundungsdifferenz.
const GLEICH = [...Array.from({ length: 11 }, () => 8.33), 8.37];
/**
 * [ANKER-3]-Rechnung (E19 vs. n/12): Stroh-Profil unten hat
 * Jul+Aug+Sep = 20+26+18 = 64 %. Eine externe Vergabe exakt 01.07.(B+2)
 * bis 30.09.(B+2) laesst im Bezugsjahr B+2 also nur 36 % der Jahresrate
 * frei — eine n/12-Naeherung haette 9/12 = 75 % behauptet.
 */
const STROH = [1, 1, 2, 3, 5, 8, 20, 26, 18, 9, 4, 3];
const GRUEN = [2, 2, 4, 8, 14, 15, 14, 13, 12, 9, 4, 3];
const REB = [24, 20, 16, 6, 3, 2, 2, 2, 3, 5, 8, 9];
const WALD = [14, 13, 11, 6, 3, 2, 2, 2, 4, 12, 15, 16];
const TRESTER = [1, 1, 1, 1, 2, 2, 3, 8, 28, 30, 18, 5];
const BIO_SOMMER = [6, 6, 7, 8, 10, 11, 11, 11, 10, 8, 6, 6];
const WINTER = [17, 15, 11, 6, 3, 2, 2, 2, 4, 9, 13, 16];
const FRUEHJAHR = [6, 12, 15, 16, 14, 8, 5, 4, 4, 5, 5, 6];
const SOMMER = [4, 4, 6, 8, 11, 14, 15, 14, 10, 6, 4, 4];

// --- Feedstock-Plan (Spec §1) --------------------------------------------------

type PreisKlasse = "pos" | "umnull" | "neg" | "stark";

interface ArtPlan {
  code: string;
  label: string;
  n: number;
  klasse: PreisKlasse;
  ts: number | [number, number];
  saison: number[];
  anbieter: string;
  sektor: string;
}

const ARTEN: ArtPlan[] = [
  { code: "waldrestholz", label: "Waldrestholz", n: 6, klasse: "pos", ts: [45, 65], saison: WALD, anbieter: "Forstbetrieb", sektor: "forstwirtschaft" },
  { code: "saegemehl", label: "Sägerestholz/Späne", n: 5, klasse: "pos", ts: 55, saison: GLEICH, anbieter: "Sägewerk", sektor: "holzwirtschaft" },
  { code: "altholz_a1_a3", label: "Altholz A1–A3", n: 5, klasse: "umnull", ts: 80, saison: GLEICH, anbieter: "Wertstoffhof", sektor: "abfallwirtschaft" },
  { code: "landschaftspflegeholz", label: "Landschaftspflegeholz", n: 4, klasse: "pos", ts: [45, 65], saison: WALD, anbieter: "Landschaftspflegeverband", sektor: "kommunal" },
  { code: "gruenschnitt", label: "Grünschnitt kommunal", n: 6, klasse: "neg", ts: 40, saison: GRUEN, anbieter: "Bauhof", sektor: "kommunal" },
  { code: "landschaftspflegeschnitt", label: "Straßenbegleitgrün", n: 3, klasse: "neg", ts: 42, saison: GRUEN, anbieter: "Straßenmeisterei", sektor: "kommunal" },
  { code: "stroh", label: "Stroh", n: 5, klasse: "pos", ts: 86, saison: STROH, anbieter: "Agrarbetrieb", sektor: "landwirtschaft" },
  { code: "rebholz", label: "Rebholz", n: 3, klasse: "umnull", ts: 55, saison: REB, anbieter: "Winzergenossenschaft", sektor: "landwirtschaft" },
  { code: "fruchttrester", label: "Trester", n: 2, klasse: "neg", ts: 30, saison: TRESTER, anbieter: "Kelterei", sektor: "lebensmittel" },
  { code: "gaerreste_fest", label: "Gärreste fest", n: 4, klasse: "neg", ts: 25, saison: GLEICH, anbieter: "Biogasanlage", sektor: "energie" },
  { code: "klaerschlamm", label: "Klärschlamm", n: 5, klasse: "stark", ts: 25, saison: GLEICH, anbieter: "Kläranlage", sektor: "kommunal" },
  { code: "bioabfall", label: "Bioabfall/Biotonne", n: 6, klasse: "neg", ts: 35, saison: BIO_SOMMER, anbieter: "Entsorgungsbetrieb", sektor: "abfallwirtschaft" },
  { code: "papierschlamm", label: "Papierschlamm", n: 2, klasse: "neg", ts: 45, saison: GLEICH, anbieter: "Papierfabrik", sektor: "industrie" },
  { code: "miscanthus", label: "Miscanthus", n: 2, klasse: "pos", ts: 80, saison: GLEICH, anbieter: "Agrarbetrieb", sektor: "landwirtschaft" },
  { code: "getreidespelzen", label: "Spelzen", n: 2, klasse: "pos", ts: 88, saison: GLEICH, anbieter: "Mühle", sektor: "lebensmittel" },
];

/** Sonderrollen je Slot-Key (`code#index`) — zentral, damit Zaehlungen stimmen. */
interface Sonder {
  anker?: string;
  bucket?: 1 | 2 | 3 | 4;
  zeitraum?: [string, string];
  ohnePreis?: boolean;
  extern?: "laufend" | "teil" | "zukunft" | "unbefristet";
  bhyo?: boolean;
  reserviert?: boolean;
  preisFix?: [number, number, number];
  /** F0b (A16): feste Koordinate fuer raeumliche Ankerfaelle; null = ohne Koordinate. */
  koordFest?: [number, number] | null;
  /** F0b: Ortsname passend zur festen Koordinate. */
  ortFest?: string;
}

const SONDER: Record<string, Sonder> = {
  "waldrestholz#0": { anker: "A14a", bucket: 1 },
  "waldrestholz#1": { anker: "A14b", bucket: 1 },
  "waldrestholz#4": { ohnePreis: true },
  "waldrestholz#5": { anker: "A2", zeitraum: [`${B}-01-01`, `${B + 40}-12-31`] },
  // F0b (A16): raeumliche Ankerfaelle fuer die VG250-Zuordnung. Punkte
  // ausserhalb der Region-Box sind hier GEWOLLT (eigener Test, Box-Test
  // nimmt A16 aus). Koordinaten gegen die Preview-DB verifiziert.
  "waldrestholz#2": { anker: "A16a", koordFest: [8.414, 49.337], ortFest: "Speyer (Kreisgrenze)" },
  "waldrestholz#3": { anker: "A16b", koordFest: [8.455, 49.317], ortFest: "Rheinufer BW" },
  "bioabfall#3": { anker: "A16d", koordFest: [9.9937, 53.5511], ortFest: "Hamburg" },
  "papierschlamm#1": { anker: "A16g", koordFest: null, ortFest: "unbekannt (ohne Koordinate)" },
  "saegemehl#1": { bhyo: true, bucket: 2 },
  "saegemehl#3": { ohnePreis: true },
  "altholz_a1_a3#0": { anker: "A10", bucket: 2, preisFix: [-40, -5, 30] },
  "altholz_a1_a3#1": { extern: "zukunft", bucket: 2 },
  "landschaftspflegeholz#0": { anker: "A6", bucket: 4, reserviert: true },
  "landschaftspflegeholz#1": { bhyo: true, bucket: 3 },
  "gruenschnitt#0": { anker: "A5", bucket: 2, extern: "unbefristet" },
  "gruenschnitt#1": { anker: "A7", bucket: 2, extern: "laufend", reserviert: true },
  "gruenschnitt#2": { anker: "A9a", bucket: 2, preisFix: [12, 20, 31] },
  "gruenschnitt#3": { anker: "A9b", bucket: 2 },
  "gruenschnitt#4": { ohnePreis: true, anker: "A16e", koordFest: [7.75, 48.58], ortFest: "Straßburg (Ausland)" },
  "gruenschnitt#5": { reserviert: true, bucket: 2, anker: "A16f", koordFest: [9.35, 47.63], ortFest: "Bodensee" },
  "landschaftspflegeschnitt#0": { anker: "A8", bucket: 2, reserviert: true },
  "landschaftspflegeschnitt#1": { extern: "zukunft", bucket: 3 },
  "stroh#0": { anker: "A3", bucket: 2, extern: "teil" },
  "stroh#1": { bhyo: true, bucket: 2 },
  "stroh#3": { ohnePreis: true },
  "rebholz#0": { extern: "teil", bucket: 2 },
  "rebholz#1": { bhyo: true, bucket: 2 },
  "fruchttrester#0": { extern: "teil", bucket: 2 },
  "fruchttrester#1": { reserviert: true, bucket: 2 },
  "gaerreste_fest#0": { extern: "laufend", bucket: 2 },
  "gaerreste_fest#2": { ohnePreis: true },
  "klaerschlamm#0": { extern: "laufend", bucket: 2 },
  "klaerschlamm#1": { bhyo: true, bucket: 2 },
  "klaerschlamm#2": { reserviert: true, bucket: 2 },
  "klaerschlamm#3": { ohnePreis: true },
  "bioabfall#0": { extern: "laufend", bucket: 2 },
  "bioabfall#1": { bhyo: true, bucket: 2, anker: "A16c", koordFest: [8.466, 49.4875], ortFest: "Mannheim" },
  "bioabfall#4": { ohnePreis: true },
  "bioabfall#5": { anker: "A1", zeitraum: [`${B - 1}-01-01`, `${B}-06-30`] },
  "papierschlamm#0": { extern: "zukunft", bucket: 2 },
  "miscanthus#0": { anker: "A4", bucket: 2, extern: "teil" },
  "miscanthus#1": { reserviert: true, bucket: 2 },
  "getreidespelzen#0": { anker: "A11", bucket: 2 },
  "getreidespelzen#1": { ohnePreis: true },
};

const BUCKET_ZEITRAUM: Record<1 | 2 | 3 | 4, [string, string]> = {
  1: [`${B - 2}-01-01`, `${B}-12-31`],
  2: [`${B}-01-01`, `${B + 5}-12-31`],
  3: [`${B + 1}-01-01`, `${B + 8}-12-31`],
  4: [`${B + 2}-01-01`, `${B + 12}-12-31`],
};
const BUCKET_SOLL: Record<1 | 2 | 3 | 4, number> = { 1: 10, 2: 25, 3: 15, 4: 8 };

/** reserviert_seit: 7 Werte, gestreut ueber die letzten 18 Monate vor STICHTAG. */
const RESERVIERT_SEIT = [
  `${B - 1}-04-15`,
  `${B - 1}-06-10`,
  `${B - 1}-08-15`, // [ANKER-8] — aelter als 12 Monate vor dem 22.09.B
  `${B - 1}-11-20`,
  `${B}-01-05`,
  `${B}-04-18`,
  `${B}-08-30`,
];

// --- Outputs-Plan (Spec §2) -----------------------------------------------------

interface ProduktPlan {
  code: string;
  label: string;
  n: number;
  einheiten: string[];
  menge: [number, number];
  preis: [number, number] | null;
  preisEinheit: string;
  abnehmer: string[];
  saison: (abnehmer: string) => number[];
}

const PRODUKTE: ProduktPlan[] = [
  { code: "h2_niederdruck", label: "H2 (Niederdruck)", n: 7, einheiten: ["t/a", "MWh/a"], menge: [20, 400], preis: [180, 280], preisEinheit: "€/MWh", abnehmer: ["ÖPNV-Betrieb", "Spedition", "Tankstellenbetreiber"], saison: () => GLEICH },
  { code: "h2_hochdruck", label: "H2 (Hochdruck)", n: 7, einheiten: ["t/a", "MWh/a"], menge: [20, 400], preis: [180, 280], preisEinheit: "€/MWh", abnehmer: ["Chemiepark", "Glasindustrie", "Spedition"], saison: () => GLEICH },
  { code: "synthesegas", label: "Synthesegas", n: 10, einheiten: ["MWh/a", "Nm³/a"], menge: [2000, 40000], preis: [60, 120], preisEinheit: "€/MWh", abnehmer: ["Industriebetrieb", "Ziegelei", "Papierfabrik"], saison: () => GLEICH },
  { code: "waerme", label: "Wärme", n: 9, einheiten: ["MWh/a"], menge: [1000, 30000], preis: [40, 90], preisEinheit: "€/MWh", abnehmer: ["Stadtwerke", "Fernwärmenetz", "Schwimmbad", "Gewächshaus"], saison: () => WINTER },
  { code: "co2", label: "CO2", n: 13, einheiten: ["t/a"], menge: [300, 12000], preis: [0.1, 0.3], preisEinheit: "€/kg", abnehmer: ["Getränkehersteller", "Gewächshaus", "Trockeneis-Service", "Betonwerk"], saison: (a) => (a === "Gewächshaus" ? FRUEHJAHR : a === "Getränkehersteller" ? SOMMER : GLEICH) },
  // Pflanzenkohle entfernt (Beschluss 22.09.2026): kein bhyo-Output, der
  // feste Rueckstand ist Asche. Die 6 Slots: +3 CO2, +2 Synthesegas, +1 Asche.
  // Asche ist fuer bhyo ein ERLOES, keine Entsorgungsposition (Beschluss
  // 22.09.2026): 10..40 €/t (E20-Einheit), durchgehend positiv.
  { code: "asche", label: "Asche", n: 4, einheiten: ["t/a"], menge: [100, 2000], preis: [10, 40], preisEinheit: "€/t", abnehmer: ["Zementwerk", "Baustoffhandel"], saison: () => GLEICH },
];

const OUT_SONDER: Record<string, Sonder> = {
  "waerme#0": { anker: "A12", bucket: 2 },
  "waerme#1": { extern: "laufend", bucket: 2 },
  "waerme#2": { reserviert: true, bucket: 2 },
  "waerme#3": { ohnePreis: true },
  "co2#0": { anker: "A13", bucket: 2, ohnePreis: true },
  "co2#1": { extern: "zukunft", bucket: 2 },
  "co2#2": { bhyo: true, bucket: 2 },
  "h2_niederdruck#0": { extern: "laufend", bucket: 2 },
  "h2_niederdruck#1": { bhyo: true, bucket: 2 },
  "h2_niederdruck#2": { ohnePreis: true },
  "h2_hochdruck#0": { extern: "teil", bucket: 3 },
  "h2_hochdruck#1": { reserviert: true, bucket: 2 },
  "synthesegas#0": { extern: "laufend", bucket: 2 },
  "synthesegas#1": { bhyo: true, bucket: 2 },
  "synthesegas#2": { ohnePreis: true },
  // Sonderrollen der entfernten Pflanzenkohle-Slots, 1:1 auf die
  // aufgestockten Produkte verschoben (§2-Zaehlungen bleiben identisch).
  "co2#10": { extern: "teil", bucket: 2 },
  "synthesegas#8": { reserviert: true, bucket: 2 },
  "asche#3": { ohnePreis: true },
  "asche#0": { reserviert: true, bucket: 2 },
  "asche#1": { ohnePreis: true },
};
const OUT_BUCKET_SOLL: Record<1 | 2 | 3 | 4, number> = { 1: 8, 2: 21, 3: 13, 4: 8 };
const OUT_RESERVIERT_SEIT = [`${B - 1}-05-20`, `${B - 1}-10-12`, `${B}-02-25`, `${B}-07-14`];

// --- Generator -------------------------------------------------------------------

export function baueSeedDaten(basisJahr: number = BASIS_JAHR): {
  akteure: SeedAkteur[];
  feedstock: SeedStrom[];
  outputs: SeedStrom[];
} {
  if (basisJahr !== B)
    throw new Error("BASIS_JAHR ist als Konstante fixiert (Determinismus).");
  // Benannte, unabhaengig gesetzte PRNG-Teilstroeme (Auftrag 23.09.2026):
  // zusaetzliche Zuege in einem Bereich verschieben andere Bereiche nicht
  // mehr (die E24-Lektion: 13 neue Beleg-Datumszuege kippten die
  // Geografie-Paare). Jeder Bereich zieht aus einem eigenen mulberry32,
  // dessen Seed sich deterministisch aus SEED und dem Namen ableitet.
  const rng = (name: string) => {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
    const z = mulberry32((SEED ^ h) >>> 0);
    const zwischen = (a: number, b: number) => a + z() * (b - a);
    const ganz = (a: number, b: number) => Math.floor(zwischen(a, b + 1));
    return { z, zwischen, ganz };
  };
  const rGeo = rng("geo");       // Koordinaten-Jitter
  const rMarkt = rng("markt");   // Mengen, TS/Asche, Preise, Saison-Jitter
  const rBeleg = rng("beleg");   // Beleg-Erhebungsdaten
  const rListen = rng("listen"); // Ziehlisten (mische)
  const rIds = rng("id");        // UUIDs
  const zwischen = rMarkt.zwischen;
  const ganz = rMarkt.ganz;
  const uuid = () => {
    const b16 = Array.from({ length: 16 }, () => rIds.ganz(0, 255));
    b16[6] = (b16[6]! & 0x0f) | 0x40;
    b16[8] = (b16[8]! & 0x3f) | 0x80;
    const h = b16.map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const mische = <T,>(arr: T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rListen.ganz(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  const saison = (profil: number[]): number[] => {
    // Gleichverteilte Profile bleiben exakt (Spec: "gleichverteilt (1/12)");
    // charakteristische Profile bekommen leichten Jitter, Summe wieder 100.
    if (profil === GLEICH) return [...GLEICH];
    const roh = profil.map((v) => Math.max(0, Math.round((v + zwischen(-0.4, 0.4)) * 10) / 10));
    const summe = roh.reduce((x, y) => x + y, 0);
    roh[11] = Math.round((roh[11]! + (100 - summe)) * 10) / 10;
    return roh;
  };
  const lognormalMenge = () => {
    // lognormal-artig: exp(N(ln 4000, 0.75)) via Box-Muller, geklemmt 500..18000
    const u1 = Math.max(rMarkt.z(), 1e-9);
    const u2 = rMarkt.z();
    const n = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = Math.exp(Math.log(4000) + 0.75 * n);
    return Math.round(Math.min(18000, Math.max(500, v)) / 10) * 10;
  };

  const akteure: SeedAkteur[] = [];
  const machAkteur = (name: string, sektor: string): number => {
    akteure.push({ id: uuid(), name: `Seed: ${name}`, sektor });
    return akteure.length - 1;
  };

  // E23: fortlaufende Nummer fuer die synthetischen Beleg-Links (Determinismus).
  let linkNr = 1;
  // E24: 2 Feedstock- + 1 Output-Strom bleiben BEWUSST ohne Beleg — die
  // Ankerfaelle "unbelegt" (A15a/A15b/A15c). Alle uebrigen entwurf-Stroeme
  // bekommen einen Beleg; ihre Zielstufe kommt weiter aus der Ziehliste.
  let unbelegtFeed = 0;
  let unbelegtOut = 0;

  // Qualitaets-/Status-/Bucket-Ziehlisten (deterministisch gemischt)
  const qualListe = mische([
    ...Array<"A">(15).fill("A"),
    ...Array<"B">(20).fill("B"),
    ...Array<"C">(18).fill("C"),
    ...Array<"D">(7).fill("D"),
  ]);
  const statusListe = mische([
    ...Array<"geprueft">(39).fill("geprueft"),
    ...Array<"in_pruefung">(12).fill("in_pruefung"),
    ...Array<"entwurf">(9).fill("entwurf"),
  ]);

  // Feedstock-Slots expandieren
  const slots = ARTEN.flatMap((art) =>
    Array.from({ length: art.n }, (_, i) => ({ art, key: `${art.code}#${i}` })),
  );

  // Bucket-Restliste: Soll minus Sonder-Festlegungen
  const bucketRest: (1 | 2 | 3 | 4)[] = [];
  {
    const belegt: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const s of slots) {
      const so = SONDER[s.key];
      if (so?.bucket) belegt[so.bucket]!++;
    }
    for (const b of [1, 2, 3, 4] as const)
      for (let i = 0; i < BUCKET_SOLL[b] - belegt[b]!; i++) bucketRest.push(b);
  }
  const bucketZieh = mische(bucketRest);

  let reserviertIdx = 0;
  let qsIdx = 0;
  let bucketIdx = 0;
  let ausreisser = 0;
  const koordJitter = () => rGeo.zwischen(-0.02, 0.02);

  const feedstock: SeedStrom[] = slots.map(({ art, key }, slotNr) => {
    const so = SONDER[key] ?? {};
    const ortIdx = slotNr % ORTE.length;
    const [ortBasis, , lng0, lat0] = ORTE[ortIdx]!;
    const ort = so.ortFest ?? ortBasis;
    // A14: zwei Belege quasi identisch — fester Punkt, minimaler Versatz.
    const a14 = so.anker === "A14a" || so.anker === "A14b";
    // Jitter IMMER ziehen (zugstabil): feste A16-Koordinaten duerfen die
    // nachfolgenden geo-Zuege nicht verschieben, sonst kippen die
    // Quasi-Duplikat-Paare.
    const jLng = koordJitter();
    const jLat = koordJitter();
    const koordFest = "koordFest" in so ? so.koordFest : undefined;
    const lng =
      koordFest !== undefined
        ? (koordFest ? koordFest[0] : null)
        : a14
          ? 8.99 + (so.anker === "A14b" ? 0.0004 : 0)
          : lng0 + jLng;
    const lat =
      koordFest !== undefined
        ? (koordFest ? koordFest[1] : null)
        : a14
          ? 49.47 + (so.anker === "A14b" ? 0.0003 : 0)
          : lat0 + jLat;

    const zeitraum =
      so.zeitraum ?? BUCKET_ZEITRAUM[so.bucket ?? bucketZieh[bucketIdx++]!];

    // Menge: lognormal; genau zwei Ausreisser > 20.000 an festen Slots.
    let menge = lognormalMenge();
    if (key === "bioabfall#2" || key === "klaerschlamm#4") {
      menge = 20500 + ganz(0, 4000);
      ausreisser++;
    }

    // TS: klaerschlamm#4 ist der eine getrocknete Beleg (90).
    const ts =
      key === "klaerschlamm#4"
        ? 90
        : Array.isArray(art.ts)
          ? ganz(art.ts[0], art.ts[1])
          : art.ts;

    // Preise
    let preisMin: number | null = null;
    let preisMittel: number | null = null;
    let preisMax: number | null = null;
    if (!so.ohnePreis) {
      if (so.preisFix) {
        [preisMin, preisMittel, preisMax] = so.preisFix;
      } else {
        const bereich: Record<PreisKlasse, [number, number]> = {
          pos: [55, 110],
          umnull: [-15, 25],
          neg: [-90, -25],
          stark: [-170, -100],
        };
        const [lo, hi] = bereich[art.klasse];
        const mittel = ganz(lo, hi);
        const spanne = Math.max(8, Math.abs(mittel) * zwischen(0.15, 0.3));
        preisMittel = mittel;
        preisMin = Math.round(mittel - spanne);
        preisMax = Math.round(mittel + Math.max(8, Math.abs(mittel) * zwischen(0.15, 0.3)));
      }
    }

    // Vergaben / Reservierung
    const vergaben: SeedVergabe[] = [];
    const empfaenger = ["Stadtwerke Region", "Bioenergie Kontor", "Regionalwerk Süd"];
    if (so.extern) {
      const an = empfaenger[ganz(0, empfaenger.length - 1)]!;
      if (so.anker === "A3")
        vergaben.push({ vergebenVon: `${B + 2}-07-01`, vergebenBis: `${B + 2}-09-30`, vergebenAn: an, anBhyo: false });
      else if (so.anker === "A4")
        vergaben.push({ vergebenVon: `${B + 2}-01-01`, vergebenBis: `${B + 2}-06-30`, vergebenAn: an, anBhyo: false });
      else if (so.extern === "unbefristet")
        vergaben.push({ vergebenVon: `${B}-01-01`, vergebenBis: null, vergebenAn: an, anBhyo: false });
      else if (so.extern === "laufend")
        vergaben.push({ vergebenVon: `${B}-01-01`, vergebenBis: `${B + 1}-12-31`, vergebenAn: an, anBhyo: false });
      else if (so.extern === "teil")
        vergaben.push({ vergebenVon: `${B + 1}-03-01`, vergebenBis: `${B + 1}-08-31`, vergebenAn: an, anBhyo: false });
      else
        vergaben.push({ vergebenVon: `${B + 2}-01-01`, vergebenBis: `${B + 3}-12-31`, vergebenAn: an, anBhyo: false });
    }
    if (so.bhyo)
      vergaben.push({
        vergebenVon: `${zeitraum[0].slice(0, 4)}-01-01` < zeitraum[0] ? zeitraum[0] : `${zeitraum[0].slice(0, 4)}-01-01`,
        vergebenBis: `${Number(zeitraum[0].slice(0, 4)) + 1}-12-31`,
        vergebenAn: "bhyo",
        anBhyo: true,
      });
    const reserviert = !!so.reserviert;
    const reserviertSeit = reserviert
      ? so.anker === "A8"
        ? `${B - 1}-08-15`
        : RESERVIERT_SEIT.filter((d) => d !== `${B - 1}-08-15`)[reserviertIdx++ % 6]!
      : null;

    // A4 braucht Gleichverteilung, sonst Artenprofil.
    const profil = so.anker === "A4" ? [...GLEICH] : saison(art.saison);
    const qualitaet = qualListe[qsIdx]!;
    const status = statusListe[qsIdx]!;
    qsIdx++;

    const unbelegtAnker =
      status === "entwurf" && !so.anker && unbelegtFeed < 2
        ? ["A15a", "A15b"][unbelegtFeed++]
        : undefined;
    const anker = so.anker ?? unbelegtAnker;
    // Eigener Teilstrom: Beleg-Datumszuege koennen andere Bereiche nicht
    // mehr verschieben — der Vor-E24-Zugverbrauchs-Hack entfaellt.
    const belegDatum = `${B}-0${rBeleg.ganz(1, 8)}-1${rBeleg.ganz(0, 5)}`;
    const ankerTag = anker ? ` [ANKER-${anker.replace("A", "")}]` : "";
    const akteurIndex = machAkteur(`${art.anbieter} ${ort}`, art.sektor);

    return {
      id: uuid(),
      belegId: null,
      akteurIndex,
      art: "biomasse" as const,
      bezeichnung: `${art.label} ${ort}${ankerTag}${MARKER}`,
      ort,
      lng: lng == null ? null : Math.round(lng * 10000) / 10000,
      lat: lat == null ? null : Math.round(lat * 10000) / 10000,
      materialartCode: art.code,
      mengeRohFm: menge,
      tsAnteilPct: ts,
      aschegehaltPct: Math.round(zwischen(1, 8) * 10) / 10,
      preisMin,
      preisMittel,
      preisMax,
      zeitraumVon: zeitraum[0],
      zeitraumBis: zeitraum[1],
      saisonalitaet: profil,
      status,
      reserviertBhyo: reserviert,
      reserviertSeit,
      vergaben,
      beleg: unbelegtAnker
        ? null
        : belegFuerZiel(
            qualitaet,
            `Synthetischer Seed-Beleg (${art.label})`,
            belegDatum,
            linkNr++,
          ),
      anker,
    };
  });
  if (ausreisser !== 2) throw new Error("Ausreisser-Slots verfehlt");

  // ---- Outputs ----------------------------------------------------------------

  const outQual = mische([
    ...Array<"A">(12).fill("A"),
    ...Array<"B">(17).fill("B"),
    ...Array<"C">(15).fill("C"),
    ...Array<"D">(6).fill("D"),
  ]);
  const outStatus = mische([
    ...Array<"geprueft">(33).fill("geprueft"),
    ...Array<"in_pruefung">(10).fill("in_pruefung"),
    ...Array<"entwurf">(7).fill("entwurf"),
  ]);
  const outSlots = PRODUKTE.flatMap((p) =>
    Array.from({ length: p.n }, (_, i) => ({ p, key: `${p.code}#${i}` })),
  );
  const outBucketRest: (1 | 2 | 3 | 4)[] = [];
  {
    const belegt: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const s of outSlots) {
      const so = OUT_SONDER[s.key];
      if (so?.bucket) belegt[so.bucket]!++;
    }
    for (const b of [1, 2, 3, 4] as const)
      for (let i = 0; i < OUT_BUCKET_SOLL[b] - belegt[b]!; i++) outBucketRest.push(b);
  }
  const outBucketZieh = mische(outBucketRest);
  let outBucketIdx = 0;
  let outResIdx = 0;
  let outIdx = 0;

  const outputs: SeedStrom[] = outSlots.map(({ p, key }, slotNr) => {
    const so = OUT_SONDER[key] ?? {};
    const [ort, , lng0, lat0] = ORTE[(slotNr * 3 + 7) % ORTE.length]!;
    const zeitraum = so.zeitraum ?? BUCKET_ZEITRAUM[so.bucket ?? outBucketZieh[outBucketIdx++]!];
    const abnehmer = p.abnehmer[slotNr % p.abnehmer.length]!;
    const einheit = p.einheiten[slotNr % p.einheiten.length]!;
    let menge =
      so.anker === "A12"
        ? 30000
        : so.anker === "A13"
          ? 12000
          : Math.round(zwischen(p.menge[0], p.menge[1]));
    if (einheit === "Nm³/a") menge = menge * 300; // grob: MWh-aequivalente Nm³-Groessenordnung
    const ohnePreis = !!so.ohnePreis;
    const preis = ohnePreis
      ? null
      : p.preis == null
        ? null
        : Math.round(zwischen(p.preis[0], p.preis[1]) * 100) / 100;

    const vergaben: SeedVergabe[] = [];
    const decker = ["Bestandslieferant", "Nachbarnetz", "Altvertrag Regionalversorger"];
    if (so.extern) {
      const an = decker[ganz(0, decker.length - 1)]!;
      if (so.extern === "laufend")
        vergaben.push({ vergebenVon: `${B}-01-01`, vergebenBis: `${B + 1}-12-31`, vergebenAn: an, anBhyo: false });
      else if (so.extern === "teil")
        vergaben.push({ vergebenVon: `${B + 1}-02-01`, vergebenBis: `${B + 1}-07-31`, vergebenAn: an, anBhyo: false });
      else
        vergaben.push({ vergebenVon: `${B + 2}-01-01`, vergebenBis: `${B + 3}-12-31`, vergebenAn: an, anBhyo: false });
    }
    if (so.bhyo)
      vergaben.push({ vergebenVon: `${B}-01-01`, vergebenBis: `${B + 2}-12-31`, vergebenAn: "bhyo", anBhyo: true });
    const reserviert = !!so.reserviert;
    const reserviertSeit = reserviert ? OUT_RESERVIERT_SEIT[outResIdx++ % OUT_RESERVIERT_SEIT.length]! : null;

    const qualitaet = outQual[outIdx]!;
    const status = outStatus[outIdx]!;
    outIdx++;
    const unbelegtAnker =
      status === "entwurf" && !so.anker && unbelegtOut < 1
        ? ["A15c"][unbelegtOut++]
        : undefined;
    const anker = so.anker ?? unbelegtAnker;
    const belegDatum = `${B}-0${rBeleg.ganz(1, 8)}-1${rBeleg.ganz(0, 5)}`;
    const ankerTag = anker ? ` [ANKER-${anker.replace("A", "")}]` : "";
    const akteurIndex = machAkteur(`${abnehmer} ${ort}`, "abnehmer");

    return {
      id: uuid(),
      belegId: null,
      akteurIndex,
      art: "output" as const,
      bezeichnung: `${p.label} für ${abnehmer}${ankerTag}${MARKER}`,
      ort,
      lng: Math.round((lng0 + koordJitter()) * 10000) / 10000,
      lat: Math.round((lat0 + koordJitter()) * 10000) / 10000,
      produktCode: p.code,
      mengeWert: menge,
      mengeEinheit: einheit,
      preis,
      preisEinheit: preis == null ? null : p.preisEinheit,
      zeitraumVon: zeitraum[0],
      zeitraumBis: zeitraum[1],
      saisonalitaet: saison(p.saison(abnehmer)),
      status,
      reserviertBhyo: reserviert,
      reserviertSeit,
      vergaben,
      beleg: unbelegtAnker
        ? null
        : belegFuerZiel(
            qualitaet,
            `Synthetischer Seed-Beleg (${p.label})`,
            belegDatum,
            linkNr++,
          ),
      anker,
    };
  });

  return { akteure, feedstock, outputs };
}
