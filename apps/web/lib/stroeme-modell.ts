// Modell und reine Logik von stroeme. (AP1i PR 3) — bewusst OHNE Datenbank-
// oder Netzwerkzugriff, damit Client-Komponenten Typen, Labels und die
// Filter-/Sortierlogik importieren koennen. Die Loader liegen in lib/stroeme.ts.

import {
  verfuegbarkeitLabel,
  type VerfuegbarkeitsErgebnis,
  type VerfuegbarkeitsStatus,
} from "./verfuegbarkeit";

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

/** Anzeige des Kreises: amtliche Bezeichnung + Name, sonst der benannte Sonderfall. */
export function kreisAnzeige(s: Pick<Strom, "verwaltung" | "lng" | "lat">): string {
  if (s.verwaltung) return `${s.verwaltung.kreisBez} ${s.verwaltung.kreisName}`;
  return verwaltungsZustand(s) === "ausserhalb" ? "außerhalb" : "ohne Koordinate";
}

/** Anzeige des Bundeslands, gleiche Sonderfall-Benennung. */
export function landAnzeige(s: Pick<Strom, "verwaltung" | "lng" | "lat">): string {
  if (s.verwaltung?.landName) return s.verwaltung.landName;
  return verwaltungsZustand(s) === "ausserhalb" ? "außerhalb" : "ohne Koordinate";
}

export interface StromBeleg {
  /** Beleg-UUID — sichtbar im Detail, suchbar in der Freitextsuche (Beschluss 22.09.2026). */
  id: string;
  typ: string;
  quellenangabe: string | null;
  href: string | null;
  externNachvollziehbar: boolean;
  gueltigBis: string | null;
  erhebungsdatum: string | null;
  amtlich: boolean | null;
  gespraechsdatum: string | null;
  gespraechspartner: string | null;
  kernnotiz: string | null;
}

export interface Strom {
  id: string;
  art: StromArt;
  akteurName: string | null;
  sektor: string | null;
  bezeichnung: string | null;
  kontaktperson: string | null;
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
  /** Abgeleiteter Verfuegbarkeitsstatus (PR 3) — nur gesetzt, wo angereichert. */
  verfuegbarkeit?: VerfuegbarkeitsErgebnis;
  erstelltAm: string;
  beleg: StromBeleg | null;
  vollstaendigkeit: number;
}

export interface StroemeFilter {
  q: string;
  region: string[];
  cluster: string[];
  /** Output-Gruppe (karte./auswertung.; stroeme. nutzt produkt/kategorie). */
  gruppe: string[];
  materialart: string[];
  qualitaet: string[];
  status: string[];
  /** Abgeleiteter Verfuegbarkeitsstatus (PR 3), Werte = VerfuegbarkeitsStatus. */
  verfuegbarkeit: string[];
  belegtyp: string[];
  landkreis: string[];
  produkt: string[];
  kategorie: string[];
  mengeMin: string;
  mengeMax: string;
  preisMin: string;
  preisMax: string;
  /** Verfuegbar ab (JJJJ-MM): zeitraum_von >= Monatsanfang. */
  vonAb: string;
  /** Erstellt am (JJJJ-MM-TT): exakter Tag. */
  erstellt: string;
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
  belegtyp: [],
  landkreis: [],
  produkt: [],
  kategorie: [],
  mengeMin: "",
  mengeMax: "",
  preisMin: "",
  preisMax: "",
  vonAb: "",
  erstellt: "",
};

/** Facetten-Schluessel in Chip-Reihenfolge des Mockups. */
export const FACETTEN: Record<StromArt, { key: keyof StroemeFilter; label: string }[]> = {
  biomasse: [
    { key: "region", label: "Region" },
    { key: "cluster", label: "Cluster" },
    { key: "materialart", label: "Materialart" },
    { key: "qualitaet", label: "Qualität" },
    { key: "status", label: "Status" },
    { key: "verfuegbarkeit", label: "Verfügbarkeit" },
    { key: "belegtyp", label: "Belegtyp" },
  ],
  output: [
    { key: "region", label: "Region" },
    { key: "landkreis", label: "Landkreis" },
    { key: "kategorie", label: "Output-Kategorie" },
    { key: "produkt", label: "Output" },
    { key: "qualitaet", label: "Qualität" },
    { key: "status", label: "Status" },
    { key: "verfuegbarkeit", label: "Verfügbarkeit" },
    { key: "belegtyp", label: "Belegtyp" },
  ],
};

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

export const BELEG_LABEL: Record<string, string> = {
  dokument_link: "Dokument/Link",
  gespraech: "Gespräch",
  angebot: "Angebot",
  absichtserklaerung: "Absichtserklärung",
  vertrag: "Vertrag",
  betriebsdaten: "Betriebsdaten",
};

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
      return s.verfuegbarkeit ? [s.verfuegbarkeit.status] : [];
    case "belegtyp":
      return s.beleg ? [s.beleg.typ] : [];
    case "landkreis":
      // E25: Filterwert ist der ARS; die Sonderfaelle sind eigene Werte.
      return [s.verwaltung?.kreisArs ?? verwaltungsZustand(s)];
    case "produkt":
      return s.produktCode ? [s.produktCode] : [];
    case "kategorie":
      return s.kategorie ? [s.kategorie] : [];
    default:
      return [];
  }
}

function preisVon(s: Strom): number | null {
  return s.art === "biomasse" ? s.preisMittel : s.preis;
}

function mengeVon(s: Strom): number | null {
  return s.art === "biomasse" ? s.mengeFm : s.mengeWert;
}

export function filterStroeme(pool: Strom[], f: StroemeFilter): Strom[] {
  const q = f.q.trim().toLowerCase();
  return pool.filter((s) => {
    for (const { key } of FACETTEN[s.art]) {
      const sel = f[key] as string[];
      if (sel.length && !facettenWert(s, key).some((v) => sel.includes(v)))
        return false;
    }
    // gruppe wirkt wie cluster nur auf die eigene Art (karte./auswertung.).
    if (
      f.gruppe.length &&
      s.art === "output" &&
      (!s.gruppe || !f.gruppe.includes(s.gruppe))
    )
      return false;
    const menge = mengeVon(s);
    if (f.mengeMin !== "" && (menge == null || menge < +f.mengeMin)) return false;
    if (f.mengeMax !== "" && (menge == null || menge > +f.mengeMax)) return false;
    const preis = preisVon(s);
    if (f.preisMin !== "" && (preis == null || preis < +f.preisMin)) return false;
    if (f.preisMax !== "" && (preis == null || preis > +f.preisMax)) return false;
    if (f.vonAb && (s.zeitraumVon ?? "") < `${f.vonAb}-01`) return false;
    if (f.erstellt && s.erstelltAm !== f.erstellt) return false;
    if (q) {
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
        ...s.regionNamen,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
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
      return s.beleg ? (BELEG_LABEL[s.beleg.typ] ?? s.beleg.typ) : "";
    case "menge":
      return mengeVon(s) ?? -Infinity;
    case "atro":
      return s.mengeAtro ?? -Infinity;
    case "preis":
      return preisVon(s) ?? -Infinity;
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
    ).map((w) => ({ wert: w, label: verfuegbarkeitLabel(art, w) })),
    belegtyp: fest(BELEG_LABEL),
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

/** Datenfilter aus searchParams — EINE Stelle fuer alle drei Views. */
export function filterAusSearchParams(sp: SearchParamsRoh): StroemeFilter {
  return {
    ...LEERER_FILTER,
    q: ersterWert(sp.q),
    region: liste(sp.region),
    cluster: liste(sp.cluster),
    gruppe: liste(sp.gruppe),
    materialart: liste(sp.materialart),
    qualitaet: liste(sp.qualitaet),
    status: liste(sp.status),
    verfuegbarkeit: liste(sp.verfuegbarkeit),
    belegtyp: liste(sp.belegtyp),
    landkreis: liste(sp.landkreis),
    produkt: liste(sp.produkt),
    kategorie: liste(sp.kategorie),
    mengeMin: ersterWert(sp.mengeMin),
    mengeMax: ersterWert(sp.mengeMax),
    preisMin: ersterWert(sp.preisMin),
    preisMax: ersterWert(sp.preisMax),
    vonAb: ersterWert(sp.vonAb),
    erstellt: ersterWert(sp.erstellt),
  };
}

/**
 * Parameter, die karte. und auswertung. teilen (Delta §5.4/§6): reine
 * Datenfilter plus sicht. Bedienzustand (detail, ansicht, sort, form, …)
 * gehoert bewusst NICHT dazu.
 */
export const GETEILTE_FILTER_PARAMS = [
  "q",
  "region",
  "cluster",
  "gruppe",
  "materialart",
  "produkt",
  "kategorie",
  "qualitaet",
  "status",
  "verfuegbarkeit",
  "belegtyp",
  "landkreis",
  "mengeMin",
  "mengeMax",
  "preisMin",
  "preisMax",
  "vonAb",
  "erstellt",
  "sicht",
] as const;
