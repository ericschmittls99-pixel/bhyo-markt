// Modell und reine Logik von stroeme. (AP1i PR 3) — bewusst OHNE Datenbank-
// oder Netzwerkzugriff, damit Client-Komponenten Typen, Labels und die
// Filter-/Sortierlogik importieren koennen. Die Loader liegen in lib/stroeme.ts.

import type { Genauigkeit } from "@/lib/adresse-pruefung";
import {
  RESERVIERUNG_VERALTET,
  RESERVIERUNG_VERALTET_LABEL,
  verfuegbarkeitLabel,
  type VerfuegbarkeitsErgebnis,
  type VerfuegbarkeitsStatus,
  type VergabeDaten,
} from "./verfuegbarkeit";
import { FILTER, altwertZuNeu, filterDef, sichtAusArt, type Ansicht } from "./filter-modell";
import { BELEG_LABEL as BELEG_LABEL_E34, BELEG_TYPEN, belegTypRang } from "./qualitaet";
import { VERIFIKATION_LABEL, VERIFIKATION_ZUSTAENDE, type VerifikationsErgebnis } from "./verifikation";
import { trifft } from "./hierarchie";
import { trifftVergabefenster } from "./vergabe-fenster";
import { OHNE_SEKTOR, ortsSchluessel } from "./hierarchie-baeume";
import {
  energieKwh,
  preisEuroMwh,
  preisEuroT,
  STOFFLICHE_PRODUKTE,
} from "./energie";

export type StromArt = "biomasse" | "output";

/** Raeumlich abgeleitete Verwaltungszuordnung eines Stroms (E25: ARS ist der Schluessel, Namen sind Anzeige). */
export interface StromVerwaltung {
  kreisArs: string;
  kreisName: string;
  kreisBez: string;
  landArs: string | null;
  landName: string | null;
}

export type VerwaltungsZustand = "zugeordnet" | "ausserhalb" | "ohne_koordinate";

/** Beide Sonderfaelle sind BENANNT und getrennt (Auftrag F0b, analog E24). */
export function verwaltungsZustand(s: Pick<Strom, "verwaltung" | "lng" | "lat">): VerwaltungsZustand {
  if (s.verwaltung) return "zugeordnet";
  return s.lng != null && s.lat != null ? "ausserhalb" : "ohne_koordinate";
}

/**
 * Anzeige des Kreises nach der VG250-Namensbildungsregel (NBD): traegt der
 * Name die Bezeichnung schon in sich ("Rhein-Neckar-Kreis", "Salzlandkreis"),
 * steht sie nicht davor — sonst "Landkreis Prignitz", "Kreisfreie Stadt
 * Speyer". Heuristik statt NBD-Attribut (im Import bewusst nicht mitgefuehrt;
 * faellt die Heuristik je auf, NBD in PR D nachziehen). Sonderfaelle benannt.
 */
export function kreisAnzeige(s: Pick<Strom, "verwaltung" | "lng" | "lat">): string {
  if (s.verwaltung) {
    const { kreisBez, kreisName } = s.verwaltung;
    return kreisName.toLowerCase().includes("kreis")
      ? kreisName
      : `${kreisBez} ${kreisName}`.trim();
  }
  return verwaltungsZustand(s) === "ausserhalb" ? "außerhalb" : "ohne Koordinate";
}

/** Anzeige des Bundeslands, gleiche Sonderfall-Benennung. */
export function landAnzeige(s: Pick<Strom, "verwaltung" | "lng" | "lat">): string {
  if (s.verwaltung?.landName) return s.verwaltung.landName;
  return verwaltungsZustand(s) === "ausserhalb" ? "außerhalb" : "ohne Koordinate";
}

/** E44: Person an einer Sperre/Zuweisung — benutzer.id, Name, E-Mail (Anzeige, Avatar). */
export interface SperrNutzer {
  id: string;
  name: string | null;
  email: string;
}
export interface StromSperreAnzeige {
  von: SperrNutzer;
  /** ISO-Zeitstempel (gesperrt_am). */
  am: string;
}

export interface StromBeleg {
  /**
   * Beleg-UUID — seit E28 nicht mehr sichtbar (die kurze Nummer steht an
   * ihrer Stelle), aber weiterhin suchbar: wer eine UUID aus einem alten
   * Protokoll hat, findet den Beleg damit (Beschluss 22.09./23.09.2026).
   */
  id: string;
  /** E28: interne Belegnummer B-000123 aus der Sequenz — Anzeige und Suche. */
  nr: string | null;
  typ: string;
  quellenangabe: string | null;
  href: string | null;
  /** E34: Freigabe zur externen Verwendung (F6) — kein Eingang der Stufe. */
  externNachvollziehbar: boolean;
  gueltigBis: string | null;
  erhebungsdatum: string | null;
  /** AP2.4 (E62, D3): Ablauf-Markierung des Pruefers (JJJJ-MM-TT) oder null. */
  abgelaufenAm?: string | null;
  kernnotiz: string | null;
}

export interface Strom {
  id: string;
  art: StromArt;
  /** F5 PR B: Filterwert der Akteur-Ebene — die ID, nicht der Name (Namen duerfen doppelt sein). */
  akteurId: string | null;
  akteurName: string | null;
  /** Sektor-Code (Referenztabelle seit Migration 0020); null = "ohne Sektor". */
  sektor: string | null;
  sektorLabel: string | null;
  bezeichnung: string | null;
  /** AP2.5 PR b: Kontaktpersonen des Akteurs — nur im internen Export/Druck (E47). */
  kontaktpersonen?: string[];
  ort: string | null;
  /**
   * F0b/E23: Landkreis und Bundesland werden NIE gespeichert — sie kommen
   * per Point-in-Polygon aus strom_verwaltung (VG250). null heisst: die
   * Koordinate liegt in keinem Gebiet ("ausserhalb") ODER es gibt keine
   * Koordinate ("ohne Koordinate") — verwaltungsZustand unterscheidet das.
   */
  verwaltung: StromVerwaltung | null;
  /** Fokusregionen, deren Gebiet den Standort enthaelt (ST_Contains). */
  regionIds: string[];
  regionNamen: string[];
  lng: number | null;
  lat: number | null;
  /** E68 PR 2: Genauigkeit des Pins (hausnummer · strasse · plz_gebiet · manuell · unbekannt). */
  standortGenauigkeit: Genauigkeit;
  // Biomasse
  cluster: string | null;
  materialartCode: string | null;
  materialartLabel: string | null;
  mengeFm: number | null;
  tsAnteil: number | null;
  aschegehalt: number | null;
  mengeAtro: number | null;
  preisMin: number | null;
  preisMittel: number | null;
  preisMax: number | null;
  preisHerkunft: string | null;
  // Output
  gruppe: string | null;
  gruppeLabel: string | null;
  produktCode: string | null;
  produktLabel: string | null;
  /** "target" | "add_on" (output_produkt.art). */
  kategorie: string | null;
  mengeWert: number | null;
  mengeEinheit: string | null;
  preis: number | null;
  preisEinheit: string | null;
  // gemeinsam
  zeitraumVon: string | null;
  zeitraumBis: string | null;
  saisonalitaet: number[] | null;
  qualitaet: string | null;
  status: string;
  /** Weiche bhyo-Reservierung (AP1j) — der Verfuegbarkeitsstatus wird daraus abgeleitet. */
  reserviertBhyo: boolean;
  /** Stempel der Reservierung (Migration 0010); null = nicht reserviert. */
  reserviertSeit: string | null;
  /** AP2.3 (E60): Gueltigkeit der Reservierung in Monaten ab reserviert_seit (parameter_wert). Loader setzt es immer. */
  reservierungMonate?: number | null;
  /** Abgeleiteter Verfuegbarkeitsstatus (PR 3) — nur gesetzt, wo angereichert. */
  verfuegbarkeit?: VerfuegbarkeitsErgebnis;
  /** F5 PR B: Vergabezeilen fuer den Filter "Vergeben ab / bis". */
  vergaben?: VergabeDaten[];
  /** AP2.4 (E62): Verifikationszustand aus strom_verifikation() — der Loader setzt ihn immer. */
  verifikation?: VerifikationsErgebnis;
  /** E44: Sperre am Strom (null = frei) und Zugewiesene — aus dem Loader. */
  sperre?: StromSperreAnzeige | null;
  zuweisungen?: SperrNutzer[];
  /** E56: von mir gesperrt, mir zugewiesen oder beteiligt — nur gesetzt, wo angereichert (lib/fuer-mich.ts). */
  fuerMich?: boolean;
  erstelltAm: string;
  beleg: StromBeleg | null;
  vollstaendigkeit: number;
}

export interface StroemeFilter {
  q: string;
  region: string[];
  cluster: string[];
  /** Output-Gruppe. */
  gruppe: string[];
  materialart: string[];
  qualitaet: string[];
  status: string[];
  /** Abgeleiteter Verfuegbarkeitsstatus (PR 3), Werte = VerfuegbarkeitsStatus. */
  verfuegbarkeit: string[];
  /** E62: die benannten Verifikationszustaende (lib/verifikation.ts). */
  verifikation: string[];
  belegtyp: string[];
  landkreis: string[];
  /** F5 PR B: Ebenen der Ortshierarchie neben landkreis. */
  bundesland: string[];
  ort: string[];
  produkt: string[];
  /** F5 PR B: Ebenen der Akteurshierarchie (Sektor-Code, Akteur-ID). */
  sektor: string[];
  akteur: string[];
  mengeMin: string;
  mengeMax: string;
  preisMin: string;
  preisMax: string;
  /** F5 PR B: energetische Groessen (MWh/a bzw. €/MWh), abgeleitet ueber Hu (E23). */
  energieMengeMin: string;
  energieMengeMax: string;
  energiePreisMin: string;
  energiePreisMax: string;
  /** F5 PR B: Erfassungsgrad-Bereich in Prozent. */
  vollMin: string;
  vollMax: string;
  /** F5 PR B: Vergabefenster (JJJJ-MM) und der Zustand "nicht vergeben". */
  vergebenVon: string;
  vergebenBis: string;
  vergabeZustand: string;
  /** Verfuegbar ab (JJJJ-MM): zeitraum_von >= Monatsanfang. */
  vonAb: string;
  /** Erstellt am (JJJJ-MM-TT): exakter Tag. */
  erstellt: string;
  /** E56: "" = Alle, "mich" = Für mich. */
  fuer: string;
}

export const LEERER_FILTER: StroemeFilter = {
  q: "",
  region: [],
  cluster: [],
  gruppe: [],
  materialart: [],
  qualitaet: [],
  status: [],
  verfuegbarkeit: [],
  verifikation: [],
  belegtyp: [],
  landkreis: [],
  bundesland: [],
  ort: [],
  produkt: [],
  sektor: [],
  akteur: [],
  mengeMin: "",
  mengeMax: "",
  preisMin: "",
  preisMax: "",
  energieMengeMin: "",
  energieMengeMax: "",
  energiePreisMin: "",
  energiePreisMax: "",
  vollMin: "",
  vollMax: "",
  vergebenVon: "",
  vergebenBis: "",
  vergabeZustand: "",
  vonAb: "",
  erstellt: "",
  fuer: "",
};

/** Facetten-Schluessel in Chip-Reihenfolge des Mockups. */
// FACETTEN ist mit E32 entfallen: Welcher Filter in welcher Ansicht und fuer
// welche Stromart gilt, steht ausschliesslich in lib/filter-modell.ts. Die
// frueheren drei Listen (hier, karte/page.tsx, auswertung/page.tsx) waren
// genau die Doppelung, die den landkreis-Fall erzeugt hat.

export const SORTIERUNGEN: Record<StromArt, [string, string][]> = {
  biomasse: [
    ["titel", "Titel"],
    ["region", "Region"],
    ["cluster", "Cluster"],
    ["materialart", "Materialart"],
    ["qualitaet", "Qualität"],
    ["status", "Status"],
    ["belegtyp", "Belegtyp"],
    ["menge", "Menge"],
    ["preis", "Preiskorridor"],
    ["von", "Verfügbar ab"],
    ["bis", "Verfügbar bis"],
    ["erstellt", "Erstellungsdatum"],
  ],
  output: [
    ["titel", "Titel"],
    ["region", "Region"],
    ["landkreis", "Landkreis"],
    ["kategorie", "Output-Kategorie"],
    ["produkt", "Output"],
    ["qualitaet", "Qualität"],
    ["status", "Status"],
    ["belegtyp", "Belegtyp"],
    ["menge", "Menge"],
    ["preis", "Preis"],
    ["von", "Verfügbar ab"],
    ["bis", "Verfügbar bis"],
    ["erstellt", "Erstellungsdatum"],
  ],
};

export const STATUS_REIHENFOLGE = ["entwurf", "in_pruefung", "geprueft", "verworfen"];

// E34: Labels und Reihenfolge der Belegtypen haben genau einen Ursprung
// (lib/qualitaet.ts). Hier nur weitergereicht, damit bestehende Importe
// stehen bleiben.
export const BELEG_LABEL: Record<string, string> = BELEG_LABEL_E34;

// --- Filtern & Sortieren (reine Funktionen, Mockup-Logik) -------------------

export const GRUPPE_LABEL: Record<string, string> = {
  primaerprodukte: "Primärprodukte",
  wasserstoff: "Wasserstoff",
  derivate: "Derivate",
  add_ons: "Add-Ons",
};

export const KATEGORIE_LABEL: Record<string, string> = {
  target: "Target Output",
  add_on: "Add-On",
};

function facettenWert(s: Strom, key: keyof StroemeFilter): string[] {
  switch (key) {
    case "region":
      return s.regionIds;
    case "cluster":
      return s.cluster ? [s.cluster] : [];
    case "materialart":
      return s.materialartCode ? [s.materialartCode] : [];
    case "qualitaet":
      // E24: null ist der benannte Zustand "unbelegt" — als Filterwert
      // adressierbar, sonst verschwaenden beleglose Stroeme aus jedem Filter.
      return [s.qualitaet ?? "unbelegt"];
    case "status":
      return [s.status];
    case "verfuegbarkeit":
      // E64: der Nebentag „Reservierung veraltet" ist als eigener Wert filterbar.
      return s.verfuegbarkeit ? [s.verfuegbarkeit.status, ...(s.verfuegbarkeit.reservierungVeraltet ? [RESERVIERUNG_VERALTET] : [])] : [];
    case "verifikation":
      // Nicht angereichert = nicht filterbar (kein stummes Raten); angereichert
      // hat JEDER Strom einen benannten Zustand (E62).
      return s.verifikation ? [s.verifikation.zustand] : [];
    case "belegtyp":
      return s.beleg ? [s.beleg.typ] : [];
    case "landkreis":
      // E25: Filterwert ist der ARS; die Sonderfaelle sind eigene Werte.
      return [s.verwaltung?.kreisArs ?? verwaltungsZustand(s)];
    case "produkt":
      return s.produktCode ? [s.produktCode] : [];
    default:
      return [];
  }
}

// --- Bereichsgroessen (F5 PR B: stofflich/energetisch getrennt) --------------

/**
 * Wert einer Bereichsgroesse fuer einen Strom. `{ ohne }` ist der BENANNTE
 * Zustand "diese Groesse existiert fuer diesen Strom nicht" (E24-Muster) —
 * er wird bei gesetzter Grenze nicht mitverglichen, sondern sichtbar
 * gezaehlt (Entscheidung Eric, 25.09.2026: weder als 0 zaehlen noch lautlos
 * verschwinden). `null` ist eine FEHLENDE ANGABE — eine Luecke im Bestand,
 * die jemand schliessen kann. Auch sie wird bei gesetzter Grenze benannt
 * gezaehlt, nur anders formuliert (GROESSEN.luecke): "ohne Energieäquivalent"
 * ist eine Eigenschaft der Sache, "ohne erfasste Menge" eine Luecke, und der
 * Nutzer soll den Unterschied sehen (Eric, 25.09.2026).
 */
export type GroessenWert = number | null | { ohne: string };

const OHNE_ENERGIE = "ohne Energieäquivalent";

/**
 * Stofflich heisst: als Masse messbar. Feedstock-Rohmenge (t FM/a) und
 * Output-Mengen in t/a. Ein Output in MWh/a oder Nm³/a hat keine stoffliche
 * Menge — seine Zahl auf der t-Skala mitzuvergleichen waere die alte
 * Einheiten-Mischung, die die Aufteilung gerade abschafft.
 */
export function stofflicheMenge(s: Strom): GroessenWert {
  if (s.art === "biomasse") return s.mengeFm;
  if (s.mengeWert == null || !s.mengeEinheit) return null;
  if (s.mengeEinheit === "t/a") return s.mengeWert;
  return { ohne: "ohne stoffliche Menge" };
}

/** Stofflicher Preis in €/t (E20): Feedstock-Korridormittel, Output €/t oder €/kg. */
export function stofflicherPreis(s: Strom): GroessenWert {
  if (s.art === "biomasse") return s.preisMittel;
  if (s.preis == null || !s.preisEinheit) return null;
  const eurT = preisEuroT(s.preis, s.preisEinheit);
  return eurT == null ? { ohne: "ohne stofflichen Preis" } : eurT;
}

/**
 * Energetische Menge in MWh/a, ueber den unteren Heizwert abgeleitet und nie
 * gespeichert (E23). co2/asche tragen den benannten Zustand — ebenso ein
 * Wert, dessen erfasste Einheit keinen belegbaren Hu-Faktor hat.
 */
export function energetischeMenge(s: Strom): GroessenWert {
  if (s.art !== "output") return null;
  if (STOFFLICHE_PRODUKTE.has(s.produktCode ?? "")) return { ohne: OHNE_ENERGIE };
  if (s.mengeWert == null || !s.mengeEinheit) return null;
  const kwh = energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit);
  return kwh == null ? { ohne: OHNE_ENERGIE } : kwh / 1000;
}

/** Energetischer Preis in €/MWh (E20), abgeleitet wie die energetische Menge. */
export function energetischerPreis(s: Strom): GroessenWert {
  if (s.art !== "output") return null;
  if (STOFFLICHE_PRODUKTE.has(s.produktCode ?? "")) return { ohne: OHNE_ENERGIE };
  if (s.preis == null || !s.preisEinheit) return null;
  const eurMwh = preisEuroMwh(s.produktCode, s.preis, s.preisEinheit);
  return eurMwh == null ? { ohne: OHNE_ENERGIE } : eurMwh;
}

/**
 * Die Bereichsfilter und ihre Groesse — EINE Quelle fuer Pruefung und
 * Bericht. Eine getrennte Zaehl-Logik koennte andere Stroeme zaehlen, als
 * die Pruefung ausschliesst.
 */
const OHNE_MENGE = "ohne erfasste Menge";
const OHNE_PREIS = "ohne erfassten Preis";

const GROESSEN: Record<
  string,
  {
    min: keyof StroemeFilter;
    max: keyof StroemeFilter;
    wert: (s: Strom) => GroessenWert;
    /** Wortlaut fuer die Luecke (`wert` liefert null): Was fehlt, ist erfassbar. */
    luecke: string;
  }
> = {
  menge: { min: "mengeMin", max: "mengeMax", wert: stofflicheMenge, luecke: OHNE_MENGE },
  preis: { min: "preisMin", max: "preisMax", wert: stofflicherPreis, luecke: OHNE_PREIS },
  energieMenge: {
    min: "energieMengeMin",
    max: "energieMengeMax",
    wert: energetischeMenge,
    luecke: OHNE_MENGE,
  },
  energiePreis: {
    min: "energiePreisMin",
    max: "energiePreisMax",
    wert: energetischerPreis,
    luecke: OHNE_PREIS,
  },
  // Der Erfassungsgrad ist immer eine Zahl; der Wortlaut ist nur der
  // Vollstaendigkeit der Tabelle halber da und wird nie erreicht.
  vollstaendigkeit: {
    min: "vollMin",
    max: "vollMax",
    wert: (s) => s.vollstaendigkeit,
    luecke: "ohne Erfassungsgrad",
  },
};

function bereichAktiv(key: string, f: StroemeFilter): boolean {
  const g = GROESSEN[key]!;
  return (f[g.min] as string) !== "" || (f[g.max] as string) !== "";
}

/**
 * Prueft einen Zahlwert gegen die Grenzen. `{ ohne }` und null fallen hier
 * heraus — filterStroemeMitBericht faengt beide VORHER ab und zaehlt sie
 * benannt; dieser Pruefer sieht sie nur, wenn er direkt aufgerufen wird.
 */
function bereichsPruefer(key: string): Pruefer {
  return (s, f) => {
    if (!bereichAktiv(key, f)) return true;
    const g = GROESSEN[key]!;
    const wert = g.wert(s);
    if (wert == null || typeof wert === "object") return false;
    const min = f[g.min] as string;
    const max = f[g.max] as string;
    if (min !== "" && wert < +min) return false;
    if (max !== "" && wert > +max) return false;
    return true;
  };
}

/**
 * Prueflogik je Filter. Der Schluessel ist derselbe wie im Filtermodell —
 * das ist der Punkt: `filterStroeme` iteriert ueber das MODELL, nicht ueber
 * eine eigene Liste. Was gilt, wird damit auch angewendet, und was fehlt,
 * meldet der Vollstaendigkeitstest, statt lautlos nichts zu tun.
 */
type Pruefer = (s: Strom, f: StroemeFilter, q: string) => boolean;

const ANWENDUNG: Record<string, Pruefer> = {
  // E56: "Für mich" wirkt nur, wenn der Schalter steht; das Flag kommt aus
  // lib/fuer-mich.ts (mengenbasiert angereichert, kein Nachladen je Zeile).
  fuerMich: (s, f) => f.fuer !== "mich" || s.fuerMich === true,
  q: (s, _f, q) => {
    if (!q) return true;
    const hay = [
      s.akteurName,
      s.bezeichnung,
      s.ort,
      s.verwaltung?.kreisName,
      s.verwaltung?.landName,
      s.materialartLabel,
      s.produktLabel,
      // Beleg-ID mitsuchen (Praefix reicht als Substring, niemand tippt 36 Zeichen).
      s.beleg?.id,
      // E28: Belegnummer mit UND ohne Praefix suchbar ("B-000123",
      // "000123", "123" als Praefixtreffer).
      s.beleg?.nr,
      s.beleg?.nr?.replace(/^B-0*/i, ""),
      ...s.regionNamen,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  },
  region: facette("region"),
  qualitaet: facette("qualitaet"),
  status: facette("status"),
  verfuegbarkeit: facette("verfuegbarkeit"),
  verifikation: facette("verifikation"),
  belegtyp: facette("belegtyp"),
  // F5 PR B: drei gruppierte Filter ueber dieselbe reine Funktion `trifft`.
  // Die Ebenen kommen aus dem Modell, nicht aus einer Kopie hier.
  materialart: hierarchie("materialart", (s) => ({
    cluster: s.cluster,
    materialart: s.materialartCode,
  })),
  produkt: hierarchie("produkt", (s) => ({
    gruppe: s.gruppe,
    produkt: s.produktCode,
  })),
  ort: hierarchie("ort", (s) => ({
    bundesland: s.verwaltung?.landArs ?? null,
    landkreis: s.verwaltung?.kreisArs ?? verwaltungsZustand(s),
    ort: s.ort ? ortsSchluessel(s.ort) : null,
  })),
  // Sektor → Akteur. Ein Akteur ohne Sektor ist ein benannter Filterwert
  // (E24, wie `ohne_koordinate` beim Kreis) — sonst waere er im Baum
  // unerreichbar und fiele bei gesetztem Sektor still heraus.
  akteur: hierarchie("akteur", (s) => ({
    sektor: s.sektor ?? OHNE_SEKTOR,
    akteur: s.akteurId,
  })),
  // F5 PR B: alle fuenf Bereichsfilter laufen ueber GROESSEN — dieselbe
  // Quelle, aus der auch der Nicht-beruecksichtigt-Bericht zaehlt.
  menge: bereichsPruefer("menge"),
  preis: bereichsPruefer("preis"),
  energieMenge: bereichsPruefer("energieMenge"),
  energiePreis: bereichsPruefer("energiePreis"),
  vollstaendigkeit: bereichsPruefer("vollstaendigkeit"),
  vergabe: (s, f) =>
    trifftVergabefenster(s, {
      von: f.vergebenVon,
      bis: f.vergebenBis,
      // Ein einziger benannter Wert; mehr braucht der Zustand nicht.
      nichtVergeben: f.vergabeZustand === "nicht_vergeben",
    }),
  vonAb: (s, f) => !f.vonAb || (s.zeitraumVon ?? "") >= `${f.vonAb}-01`,
  erstellt: (s, f) => !f.erstellt || s.erstelltAm === f.erstellt,
};

/**
 * Gruppierter Filter: Die Ebenen kommen aus dem Filtermodell, die Werte des
 * Stroms liefert der Aufrufer. Getroffen ist ein Strom, wenn er auf EINER
 * gewaehlten Ebene passt (`trifft`).
 */
function hierarchie(
  key: string,
  werte: (s: Strom) => Record<string, string | null>,
): Pruefer {
  return (s, f) => {
    const def = filterDef(key);
    if (!def?.ebenen) return true;
    const auswahl: Record<string, string[]> = {};
    for (const e of def.ebenen) auswahl[e.param] = (f as never)[e.param] ?? [];
    return trifft(auswahl, [...def.ebenen], werte(s));
  };
}

function facette(key: keyof StroemeFilter): Pruefer {
  return (s, f) => {
    const sel = f[key] as string[];
    return !sel.length || facettenWert(s, key).some((v) => sel.includes(v));
  };
}

/**
 * Welche Filter tatsaechlich angewendet werden, als `schluessel:stromart`.
 * Kommt aus DENSELBEN Daten wie die Anwendung — eine getrennte Liste waere
 * eine zweite Wahrheit und koennte genau den Bruch verdecken, den der
 * Vollstaendigkeitstest finden soll.
 */
export function angewandteSchluessel(): string[] {
  const out: string[] = [];
  for (const def of FILTER) {
    if (!ANWENDUNG[def.key]) continue;
    for (const art of def.arten) out.push(`${def.key}:${art}`);
  }
  return out;
}

/**
 * Ein Grund, aus dem Stroeme trotz passender uebriger Filter fehlen, samt
 * Anzahl. `art` traegt den Unterschied, der fuer den Nutzer wesentlich ist:
 * eine `eigenschaft` (Asche hat keinen Heizwert, daran aendert niemand etwas)
 * oder eine `luecke` (keine Menge erfasst — die kann er schliessen).
 */
export interface NichtBeruecksichtigt {
  grund: string;
  anzahl: number;
  art: "eigenschaft" | "luecke";
}

export interface FilterErgebnis {
  stroeme: Strom[];
  /**
   * Stroeme, die JEDE andere Bedingung erfuellen, aber eine gesetzte
   * Bereichsgroesse nicht besitzen (benannter Zustand, z. B. "ohne
   * Energieäquivalent") oder nicht erfasst haben (Luecke, z. B. "ohne
   * erfasste Menge"). Die Leiste weist beides getrennt aus — wer eine
   * energetische Grenze setzt, soll sehen, dass co2/asche nicht
   * mitverglichen wurden, und wer eine Menge vergessen hat, soll es genau
   * dann erfahren, wenn es ihm nuetzt. Eigenschaften stehen vor Luecken.
   */
  nichtBeruecksichtigt: NichtBeruecksichtigt[];
}

/**
 * Filtert und berichtet in einem Lauf. Die Ansicht gehoert zur Signatur,
 * weil ein Filter, den das Modell hier nicht vorsieht, auch nicht wirken
 * darf (E32) — vorher entschied allein die Stromart, und ein gesetzter
 * vonAb wirkte in auswertung., waehrend die Leiste ihn als "gilt hier
 * nicht" auswies.
 */
export function filterStroemeMitBericht(
  pool: Strom[],
  f: StroemeFilter,
  ansicht: Ansicht,
): FilterErgebnis {
  const q = f.q.trim().toLowerCase();
  const stroeme: Strom[] = [];
  const zaehler = new Map<string, NichtBeruecksichtigt>();

  for (const s of pool) {
    const art = sichtAusArt(s.art);
    // Ein Strom zaehlt je Grund einmal, auch wenn zwei Grenzen (Menge UND
    // Preis) dieselbe fehlende Groesse treffen.
    const gruende = new Map<string, NichtBeruecksichtigt["art"]>();
    let besteht = true;
    for (const def of FILTER) {
      if (!def.ansichten.includes(ansicht)) continue;
      if (!def.arten.includes(art)) continue;
      const groesse = GROESSEN[def.key];
      if (groesse && bereichAktiv(def.key, f)) {
        const wert = groesse.wert(s);
        if (wert == null) {
          gruende.set(groesse.luecke, "luecke");
          continue;
        }
        if (typeof wert === "object") {
          gruende.set(wert.ohne, "eigenschaft");
          continue;
        }
      }
      const pruefer = ANWENDUNG[def.key];
      // Kein stillschweigendes Ueberspringen: Fehlt hier ein Pruefer, taucht
      // der Schluessel auch nicht in angewandteSchluessel() auf, und der
      // Vollstaendigkeitstest meldet ihn namentlich.
      if (!pruefer) continue;
      if (!pruefer(s, f, q)) {
        besteht = false;
        break;
      }
    }
    if (!besteht) continue;
    if (gruende.size > 0) {
      for (const [grund, gArt] of gruende) zaehle(zaehler, { grund, anzahl: 1, art: gArt });
      continue;
    }
    stroeme.push(s);
  }

  return { stroeme, nichtBeruecksichtigt: sortiertePosten(zaehler) };
}

function zaehle(zaehler: Map<string, NichtBeruecksichtigt>, n: NichtBeruecksichtigt): void {
  const bisher = zaehler.get(n.grund);
  zaehler.set(n.grund, { ...n, anzahl: (bisher?.anzahl ?? 0) + n.anzahl });
}

/** Eigenschaften vor Luecken, sonst in Reihenfolge des Auftretens (stabil). */
function sortiertePosten(zaehler: Map<string, NichtBeruecksichtigt>): NichtBeruecksichtigt[] {
  const rang = (n: NichtBeruecksichtigt) => (n.art === "eigenschaft" ? 0 : 1);
  return [...zaehler.values()].sort((a, b) => rang(a) - rang(b));
}

/** Leisten-Wortlaut, an einer Stelle: "3 Ströme ohne Energieäquivalent nicht berücksichtigt". */
export function nichtBeruecksichtigtText(n: NichtBeruecksichtigt): string {
  return `${n.anzahl} ${n.anzahl === 1 ? "Strom" : "Ströme"} ${n.grund} nicht berücksichtigt`;
}

/** Fasst die Berichte mehrerer Teil-Pools (z. B. Feedstock + Outputs auf der Karte) zusammen. */
export function fasseBerichteZusammen(
  ...berichte: NichtBeruecksichtigt[][]
): NichtBeruecksichtigt[] {
  const zaehler = new Map<string, NichtBeruecksichtigt>();
  for (const bericht of berichte) for (const n of bericht) zaehle(zaehler, n);
  return sortiertePosten(zaehler);
}

export function filterStroeme(pool: Strom[], f: StroemeFilter, ansicht: Ansicht): Strom[] {
  return filterStroemeMitBericht(pool, f, ansicht).stroeme;
}

function sortWert(s: Strom, key: string): string | number {
  switch (key) {
    case "titel":
      return (s.akteurName ?? "").toLowerCase();
    case "region":
      return (s.regionNamen[0] ?? "").toLowerCase();
    case "cluster":
      return s.cluster ?? "";
    case "materialart":
      return s.materialartLabel ?? "";
    case "landkreis":
      // Sonderfaelle hinter die Namen (ausserhalb/ohne Koordinate am Ende).
      return s.verwaltung ? s.verwaltung.kreisName : `\uffff${verwaltungsZustand(s)}`;
    case "kategorie":
      return s.kategorie ?? "";
    case "produkt":
      return s.produktLabel ?? "";
    case "qualitaet":
      // E24: unbelegt sortiert HINTER der niedrigsten Stufe ("E" > "D").
      return s.qualitaet ?? "E";
    case "status":
      return STATUS_REIHENFOLGE.indexOf(s.status);
    case "belegtyp":
      // E34: sortiert nach Rangfolge der Beweiskraft, nicht alphabetisch;
      // ohne Beleg hinter allen Typen.
      return s.beleg ? belegTypRang(s.beleg.typ) : BELEG_TYPEN.length + 1;
    case "menge":
      // Sortiert wird weiter ueber den ROHEN Erfassungswert (bewusst nicht
      // Teil der stofflich/energetisch-Trennung der Filter, F5 PR B).
      return (s.art === "biomasse" ? s.mengeFm : s.mengeWert) ?? -Infinity;
    case "atro":
      return s.mengeAtro ?? -Infinity;
    case "preis":
      return (s.art === "biomasse" ? s.preisMittel : s.preis) ?? -Infinity;
    case "von":
      return s.zeitraumVon ?? "";
    case "bis":
      return s.zeitraumBis ?? "";
    default:
      return s.erstelltAm;
  }
}

export function sortiereStroeme(
  liste: Strom[],
  key: string,
  richtung: "auf" | "ab",
): Strom[] {
  const dir = richtung === "auf" ? 1 : -1;
  return [...liste].sort((a, b) => {
    const va = sortWert(a, key);
    const vb = sortWert(b, key);
    // Deutsche Sortierung fuer Texte (Ä neben A), Zahlen numerisch.
    if (typeof va === "string" && typeof vb === "string")
      return va.localeCompare(vb, "de") * dir;
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

export interface FacettenOption {
  wert: string;
  label: string;
}

/**
 * Optionen je Facette: feste Listen (Cluster, Qualitaet, Status, Belegtyp,
 * Kategorie), Regionen aus der DB, der Rest aus den im Pool vorhandenen Werten
 * (wie im Mockup `fromData`).
 */
export function facettenOptionen(
  art: StromArt,
  pool: Strom[],
  regionen: { id: string; name: string }[],
  clusterLabel: Record<string, string>,
): Record<string, FacettenOption[]> {
  const ausPool = (fn: (s: Strom) => [string, string] | null) => {
    const map = new Map<string, string>();
    for (const s of pool) {
      const kv = fn(s);
      if (kv) map.set(kv[0], kv[1]);
    }
    return [...map.entries()]
      .map(([wert, label]) => ({ wert, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "de"));
  };

  const fest = (o: Record<string, string>) =>
    Object.entries(o).map(([wert, label]) => ({ wert, label }));

  const gemeinsam = {
    region: regionen.map((r) => ({ wert: r.id, label: r.name })),
    qualitaet: [
      ...["A", "B", "C", "D"].map((q) => ({ wert: q, label: q })),
      // E24: eigener Filterwert fuer Stroeme ohne Beleg.
      { wert: "unbelegt", label: "unbelegt" },
    ],
    status: [
      { wert: "entwurf", label: "Entwurf" },
      { wert: "in_pruefung", label: "In Prüfung" },
      { wert: "geprueft", label: "Geprüft" },
      { wert: "verworfen", label: "Verworfen" },
    ],
    // Feste 6er-Liste (kein ausPool: der Status ist abgeleitet und soll auch
    // waehlbar sein, wenn er gerade nicht vorkommt); Labels je Stromart.
    verfuegbarkeit: (
      [
        "verfuegbar",
        "vergeben_extern",
        "vergeben_bhyo",
        "reserviert_bhyo",
        "noch_nicht_verfuegbar",
        "abgelaufen",
      ] as VerfuegbarkeitsStatus[]
    )
      .map((w): { wert: string; label: string } => ({ wert: w, label: verfuegbarkeitLabel(art, w) }))
      // E64: Nebentag als siebte Option — waehlbar, auch wenn er gerade nicht vorkommt.
      .concat([{ wert: RESERVIERUNG_VERALTET, label: RESERVIERUNG_VERALTET_LABEL }]),
    belegtyp: fest(BELEG_LABEL),
    // E62: feste Liste der benannten Zustaende — abgeleitet und waehlbar, auch
    // wenn einer gerade nicht vorkommt (laeuft_bald_ab kommt mit PR b dazu).
    verifikation: VERIFIKATION_ZUSTAENDE.map((w) => ({ wert: w, label: VERIFIKATION_LABEL[w] })),
  };

  if (art === "biomasse") {
    return {
      ...gemeinsam,
      cluster: fest(clusterLabel),
      materialart: ausPool((s) =>
        s.materialartCode ? [s.materialartCode, s.materialartLabel ?? s.materialartCode] : null,
      ),
    };
  }
  return {
    ...gemeinsam,
    landkreis: [
      ...ausPool((s) =>
        s.verwaltung ? [s.verwaltung.kreisArs, s.verwaltung.kreisName] : null,
      ),
      // F0b: beide Sonderfaelle als eigene, getrennte Filteroptionen.
      { wert: "ausserhalb", label: "außerhalb" },
      { wert: "ohne_koordinate", label: "ohne Koordinate" },
    ],
    kategorie: fest(KATEGORIE_LABEL),
    produkt: ausPool((s) =>
      s.produktCode ? [s.produktCode, s.produktLabel ?? s.produktCode] : null,
    ),
  };
}

// --- Querystring (geteilt zwischen stroeme., karte., auswertung.) -----------

export type SearchParamsRoh = Record<string, string | string[] | undefined>;

function ersterWert(v: string | string[] | undefined): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s ?? "";
}

/** Mehrwertige Facette: kommagetrennt im Querystring (Delta-Bericht §6). */
function liste(v: string | string[] | undefined): string[] {
  return ersterWert(v).split(",").filter(Boolean);
}

/**
 * Datenfilter aus searchParams — die Schluessel kommen aus dem Filtermodell,
 * nicht aus einer zweiten Aufzaehlung daneben.
 */
export function filterAusSearchParams(sp: SearchParamsRoh): StroemeFilter {
  const f: StroemeFilter = { ...LEERER_FILTER };
  for (const def of FILTER) {
    for (const param of def.params) {
      const roh = sp[param];
      if (def.typ === "facette" || def.typ === "hierarchie") {
        (f as unknown as Record<string, unknown>)[param] = liste(roh).map((w) =>
          altwertZuNeu(param, w),
        );
      } else {
        (f as unknown as Record<string, unknown>)[param] = ersterWert(roh);
      }
    }
  }
  return f;
}

// GETEILTE_FILTER_PARAMS ist mit E32 entfallen — die Parameterliste leitet
// sich aus dem Filtermodell ab (FILTER_PARAMS in lib/filter-modell.ts).
