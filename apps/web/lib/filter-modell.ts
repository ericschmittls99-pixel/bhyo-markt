/**
 * E32 — Ein Filtermodell. Die EINZIGE Stelle, an der ein Filter definiert
 * wird: Schlüssel, Beschriftung, Werttyp, Zugehörigkeit zu Ansichten und
 * Stromarten, und ob er zu den Hauptfiltern gehört oder unter „weitere
 * Filter" liegt.
 *
 * Alle Ansichten leiten ihre Leiste hieraus ab. Handgeschriebene Listen je
 * Ansicht gibt es nicht — vorher standen dieselben Facetten dreimal
 * nebeneinander (`FACETTEN`, `karte/page.tsx`, `auswertung/page.tsx`) und
 * `BEREICH_KEYS` sogar dreimal mit zwei verschiedenen Inhalten.
 *
 * **Die Zugehörigkeit ist ausdrücklich, nicht zufällig.** Dass ein Filter in
 * einer Ansicht fehlt, ist eine Festlegung in diesem Modell — kein
 * Nebeneffekt davon, wo ihn jemand zuerst gebraucht hat. Genau dieser
 * Unterschied hat den `landkreis`-Fall erzeugt: Der Filter war für Outputs
 * eingeführt und wurde für Feedstock nie angewandt, ohne dass es auffiel.
 *
 * `lib/filter-modell.test.ts` prüft deshalb zweierlei dauerhaft:
 * Vollständigkeit (jeder geltende Schlüssel wird auch angewendet) und
 * Einzigkeit (genau eine Definition, genau eine Facettenliste).
 */

/** Die drei Ansichten mit Filterleiste. */
export const ANSICHTEN = ["stroeme", "karte", "auswertung"] as const;
export type Ansicht = (typeof ANSICHTEN)[number];

/**
 * Stromart in der Adresszeile — durchgehend `feedstock`, nie `biomasse`:
 * Der Bestand umfasst auch Polymere, „Biomasse" wäre die engere Aussage.
 * `tab=biomasse|output` ist damit abgelöst.
 *
 * Der interne Diskriminator `Strom.art` behält vorerst die Werte
 * `biomasse`/`output`, weil sie als Literale aus den SQL-Abfragen kommen
 * (`'biomasse' AS art`) — sie sind Datenseite, nicht Anzeige. Umgerechnet
 * wird an genau einer Stelle: `artAusSicht` / `sichtAusArt`.
 */
export const SICHTEN = ["feedstock", "outputs", "alle"] as const;
export type Sicht = (typeof SICHTEN)[number];

/** Welche Stromart ein Filter betrifft. */
export type FilterArt = "feedstock" | "outputs";

export type FilterTyp =
  /** Freitext, ein Parameter. */
  | "text"
  /** Mehrfachauswahl, kommagetrennt in einem Parameter. */
  | "facette"
  /** Zwei Parameter (Min/Max). */
  | "bereich"
  /** Ein Monat (JJJJ-MM). */
  | "monat"
  /** Ein Datum (JJJJ-MM-TT). */
  | "datum"
  /** Gruppierter Baum mit einem Parameter je Ebene (F5 PR B). */
  | "hierarchie"
  /**
   * Zeitfenster mit zwei Monatsgrenzen UND einem benannten Zustand
   * (F5 PR B). Kein `bereich`: Der dritte Parameter traegt den Zustand
   * „nicht vergeben" — ihn als Bereich auszugeben hiesse, den Unterschied
   * zu verwischen.
   */
  | "zeitfenster";

export interface FilterDef {
  /** Logischer Name; bei einfachen Filtern zugleich der URL-Parameter. */
  key: string;
  label: string;
  typ: FilterTyp;
  /** URL-Parameter dieses Filters — bei `bereich` zwei, sonst einer. */
  params: readonly string[];
  /** In welchen Ansichten er gilt. */
  ansichten: readonly Ansicht[];
  /** Für welche Stromarten er gilt. */
  arten: readonly FilterArt[];
  /** Hauptfilter oder unter „weitere Filter" (zusammengeklappt). */
  gruppe: "haupt" | "weitere";
  /**
   * Nur bei `hierarchie`: die Ebenen von oben nach unten. Ihre `param`
   * entsprechen `params` in derselben Reihenfolge — eine zweite Liste waere
   * eine zweite Wahrheit.
   */
  ebenen?: readonly { param: string; label: string }[];
  /**
   * Was passiert, wenn der Filter in der aktuellen Ansicht nicht gilt.
   * Voreinstellung `merken` (E32): Er bleibt in der Adresszeile, wirkt
   * nicht, die Leiste weist ihn aus, und beim Zurückwechseln greift er
   * wieder. `verwerfen` ist die ausdrückliche Ausnahme.
   */
  beiNichtgeltung?: "merken" | "verwerfen";
}

const BEIDE: readonly FilterArt[] = ["feedstock", "outputs"];
const ALLE_ANSICHTEN: readonly Ansicht[] = ANSICHTEN;

/**
 * Der heutige Bestand, zusammengeführt und mit ausdrücklicher Zugehörigkeit.
 * PR A fügt KEINE Filter hinzu — die neuen Zeilen der Zielmatrix (Sektor,
 * Ort-Hierarchie, Vollständigkeit, Verifikation, energetische Menge und
 * Preis, Vergabezeitraum) kommen mit PR B.
 */
export const FILTER: readonly FilterDef[] = [
  {
    key: "q",
    label: "Freitext",
    typ: "text",
    params: ["q"],
    // auswertung. hat bewusst kein Suchfeld (Zielmatrix).
    ansichten: ["stroeme", "karte"],
    arten: BEIDE,
    gruppe: "haupt",
    // Ausdrückliche Ausnahme von E32 (Entscheidung Eric, 25.09.2026): Ein
    // gemerkter Freitext ohne Eingabefeld wäre in auswertung. nicht
    // korrigierbar, nur abwählbar — deshalb wird er beim Wechsel entfernt.
    // Hinweis: Das kostet den Suchtext beim Hin- und Zurückwechseln; die
    // E32-Regel („merken, nicht anwenden, ausweisen") täte das nicht.
    beiNichtgeltung: "verwerfen",
  },
  {
    key: "region",
    label: "Region",
    typ: "facette",
    params: ["region"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // F5 PR B: Cluster und Materialart sind EIN gruppierter Filter, kein
    // Paar nebeneinander — wer einen Cluster waehlt, meint seine
    // Materialarten mit.
    key: "materialart",
    label: "Cluster / Materialart",
    typ: "hierarchie",
    params: ["cluster", "materialart"],
    ebenen: [
      { param: "cluster", label: "Cluster" },
      { param: "materialart", label: "Materialarten" },
    ],
    ansichten: ALLE_ANSICHTEN,
    arten: ["feedstock"],
    gruppe: "haupt",
  },
  {
    key: "produkt",
    label: "Gruppe / Output",
    typ: "hierarchie",
    params: ["gruppe", "produkt"],
    ebenen: [
      { param: "gruppe", label: "Gruppen" },
      { param: "produkt", label: "Outputs" },
    ],
    ansichten: ALLE_ANSICHTEN,
    arten: ["outputs"],
    gruppe: "haupt",
  },
  {
    // Bundesland und Landkreis raeumlich ueber den ARS (E25), der Ort aus
    // den strukturierten Adressfeldern (F0a). Gilt jetzt in ALLEN Ansichten
    // und fuer beide Stromarten — der landkreis-Fall aus PR A ist damit
    // nicht nur geschlossen, sondern zur vollen Hierarchie ausgebaut.
    key: "ort",
    label: "Bundesland / Landkreis / Ort",
    typ: "hierarchie",
    params: ["bundesland", "landkreis", "ort"],
    ebenen: [
      { param: "bundesland", label: "Bundesländer" },
      { param: "landkreis", label: "Landkreise" },
      { param: "ort", label: "Orte" },
    ],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // F5 PR B: Sektor (Referenztabelle, Migration 0020) → Akteur. Die
    // Akteur-Ebene traegt die ID, nicht den Namen — zwei Akteure duerfen
    // gleich heissen. "ohne Sektor" ist ein eigener Wert (E24).
    key: "akteur",
    label: "Sektor / Akteur",
    typ: "hierarchie",
    params: ["sektor", "akteur"],
    ebenen: [
      { param: "sektor", label: "Sektoren" },
      { param: "akteur", label: "Akteure" },
    ],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // F5 PR B: "stofflich" heisst, was sich als Masse messen laesst —
    // Feedstock-Rohmenge und Output-Mengen in t/a. Ein Output in MWh/a hat
    // KEINE stoffliche Menge und wird bei gesetzter Grenze nicht
    // beruecksichtigt (sichtbar ausgewiesen), statt seine Zahl auf einer
    // fremden Skala mitzuvergleichen.
    key: "menge",
    label: "Menge stofflich",
    typ: "bereich",
    params: ["mengeMin", "mengeMax"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // F5 PR B: abgeleitet ueber den unteren Heizwert (lib/energie.ts),
    // nie gespeichert (E23). co2/asche tragen den benannten Zustand
    // "ohne Energieaequivalent" und werden bei gesetzter Grenze nicht
    // beruecksichtigt — die Leiste sagt das sichtbar (Entscheidung Eric,
    // 25.09.2026: weder als 0 zaehlen noch lautlos verschwinden).
    key: "energieMenge",
    label: "Menge energetisch",
    typ: "bereich",
    params: ["energieMengeMin", "energieMengeMax"],
    ansichten: ALLE_ANSICHTEN,
    arten: ["outputs"],
    gruppe: "haupt",
  },
  {
    // Stofflicher Preis in €/t: Feedstock-Preiskorridor (Mittel) und
    // Output-Preise, die je Tonne erfasst sind (€/kg wird umgerechnet,
    // E20). €/MWh und €/Nm³ sind kein stofflicher Preis.
    key: "preis",
    label: "Preis stofflich",
    typ: "bereich",
    params: ["preisMin", "preisMax"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // Energetischer Preis in €/MWh, abgeleitet wie die energetische Menge.
    key: "energiePreis",
    label: "Preis energetisch",
    typ: "bereich",
    params: ["energiePreisMin", "energiePreisMax"],
    ansichten: ALLE_ANSICHTEN,
    arten: ["outputs"],
    gruppe: "haupt",
  },
  {
    key: "verfuegbarkeit",
    label: "Verfügbarkeit",
    typ: "facette",
    params: ["verfuegbarkeit"],
    // Entscheidung Eric 25.09.2026: In auswertung. uebernehmen die
    // anklickbaren Jahrespillen diese Rolle.
    ansichten: ["stroeme", "karte"],
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // F5 PR B: Zwei Felder, ein Filter. Beantwortet "was ist in diesem
    // Zeitraum vergeben" (Ueberschneidung). Der dritte Parameter traegt den
    // benannten Zustand "nicht vergeben" (E24) — sonst fielen Stroeme ohne
    // Vergabe still heraus. Die Zielmatrix fuehrt ihn unter "weitere
    // Filter" — die erste Fassung hatte ihn faelschlich als Hauptfilter.
    key: "vergabe",
    label: "Vergeben ab / bis",
    typ: "zeitfenster",
    params: ["vergebenVon", "vergebenBis", "vergabeZustand"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    key: "vonAb",
    label: "Verfügbar ab",
    typ: "monat",
    params: ["vonAb"],
    ansichten: ["stroeme", "karte"],
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    key: "qualitaet",
    label: "Qualität",
    typ: "facette",
    params: ["qualitaet"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    key: "status",
    label: "Status",
    typ: "facette",
    params: ["status"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    // E33 (26.09.2026): aktiv / ausgelaufen / keine Frist, gemessen an der
    // Gesamtfaelligkeit (Belegfrist, Verfuegbarkeitsende, befristete
    // Vergaben, Reservierung) gegen das heutige Datum. Anders als die
    // Verfuegbarkeit gilt er auch in auswertung.: dort spielt niemand sonst
    // diese Rolle, das Verifizierungs-Modul zeigt nur die drei naechsten.
    key: "verifikation",
    label: "Verifizierung",
    typ: "facette",
    params: ["verifikation"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    // F5 PR B: Erfassungsgrad 0-100 aus lib/vollstaendigkeit.ts, als
    // Min/Max-Bereich in Prozent (Entscheidung Eric, 25.09.2026): Eine
    // Untergrenze allein deckt den haeufigen Fall "mindestens 80 %" ab,
    // ohne dass wir Stufen erfinden.
    key: "vollstaendigkeit",
    label: "Vollständigkeit",
    typ: "bereich",
    params: ["vollMin", "vollMax"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    key: "belegtyp",
    label: "Belegtyp",
    typ: "facette",
    params: ["belegtyp"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
  {
    key: "erstellt",
    label: "Erstellt am",
    typ: "datum",
    params: ["erstellt"],
    ansichten: ALLE_ANSICHTEN,
    arten: BEIDE,
    gruppe: "weitere",
  },
];

// --- Abgeleitetes ----------------------------------------------------------

/** Alle URL-Parameter der Datenfilter — ersetzt GETEILTE_FILTER_PARAMS. */
export const FILTER_PARAMS: readonly string[] = FILTER.flatMap((f) => f.params);

const NACH_KEY = new Map(FILTER.map((f) => [f.key, f]));
const NACH_PARAM = new Map(FILTER.flatMap((f) => f.params.map((p) => [p, f] as const)));

/**
 * E34: Alte Filterwerte in gespeicherten Adressen (Lesezeichen, geteilte
 * Links) werden auf den heutigen Wert abgebildet, statt still ins Leere zu
 * filtern. `belegtyp=dokument_link` hiess mit Migration 0021 `dokument`.
 * Genau eine Stelle; die Facettenwerte laufen beim Einlesen hindurch.
 */
export const ALTWERTE: Record<string, Record<string, string>> = {
  belegtyp: { dokument_link: "dokument" },
};

export function altwertZuNeu(param: string, wert: string): string {
  return ALTWERTE[param]?.[wert] ?? wert;
}

export function filterDef(key: string): FilterDef | undefined {
  return NACH_KEY.get(key);
}

export function filterZuParam(param: string): FilterDef | undefined {
  return NACH_PARAM.get(param);
}

/** Gilt dieser Filter hier? Beides muss stimmen: Ansicht UND Stromart. */
export function gilt(f: FilterDef, ansicht: Ansicht, sicht: Sicht): boolean {
  if (!f.ansichten.includes(ansicht)) return false;
  // Sicht "alle" zeigt beide Arten — ein Filter gilt dann, wenn er fuer
  // mindestens eine davon gilt.
  if (sicht === "alle") return f.arten.length > 0;
  return f.arten.includes(sicht);
}

/** Die Filter einer Ansicht, in der Reihenfolge des Modells. */
export function filterFuer(ansicht: Ansicht, sicht: Sicht): FilterDef[] {
  return FILTER.filter((f) => gilt(f, ansicht, sicht));
}

/** Nur die Hauptfilter bzw. nur „weitere Filter" einer Ansicht. */
export function filterFuerGruppe(
  ansicht: Ansicht,
  sicht: Sicht,
  gruppe: FilterDef["gruppe"],
): FilterDef[] {
  return filterFuer(ansicht, sicht).filter((f) => f.gruppe === gruppe);
}

/** Parameter, die beim Wechsel in diese Ansicht entfernt werden (E32-Ausnahme). */
export function zuVerwerfen(ansicht: Ansicht, sicht: Sicht): string[] {
  return FILTER.filter(
    (f) => f.beiNichtgeltung === "verwerfen" && !gilt(f, ansicht, sicht),
  ).flatMap((f) => f.params);
}

// --- Sicht <-> interner Diskriminator --------------------------------------

/** Der interne Diskriminator von `Strom.art` (Datenseite, siehe oben). */
export type StromArtIntern = "biomasse" | "output";

export function artAusSicht(sicht: Sicht): StromArtIntern | null {
  if (sicht === "feedstock") return "biomasse";
  if (sicht === "outputs") return "output";
  return null; // "alle"
}

export function sichtAusArt(art: StromArtIntern): FilterArt {
  return art === "biomasse" ? "feedstock" : "outputs";
}

/**
 * Liest `sicht` aus der Adresszeile. Ein unbekannter Wert wird auf den
 * Standard gesetzt; `umgeschrieben` sagt dem Aufrufer, dass die URL zu
 * korrigieren ist (E32) — stillschweigend auf etwas anderes auszuweichen
 * wäre genau die Sorte Verhalten, die das Modell abschafft.
 */
export function leseSicht(
  roh: string | undefined,
  standard: Sicht,
  erlaubt: readonly Sicht[] = SICHTEN,
): { sicht: Sicht; umgeschrieben: boolean } {
  if (roh && (erlaubt as readonly string[]).includes(roh)) {
    return { sicht: roh as Sicht, umgeschrieben: false };
  }
  return { sicht: standard, umgeschrieben: roh !== undefined && roh !== "" };
}

// --- Leiste je Ansicht -----------------------------------------------------

export interface FilterOption {
  wert: string;
  label: string;
}

export interface LeisteEintrag {
  def: FilterDef;
  optionen: FilterOption[];
}

export interface Leiste {
  /** Hauptfilter (immer sichtbar). */
  haupt: LeisteEintrag[];
  /** „weitere Filter" (zusammengeklappt). */
  weitere: LeisteEintrag[];
  /** Mehrfachauswahl je Facetten-Parameter. */
  auswahl: Record<string, string[]>;
  /** Einzelwerte je Bereichs-, Monats- und Datumsparameter. */
  bereich: Record<string, string>;
  /** Ist irgendein hier geltender Filter gesetzt? */
  irgendeinFilter: boolean;
  /**
   * E32: Filter, die gesetzt sind, hier aber NICHT gelten. Sie bleiben in der
   * Adresszeile und wirken nicht; die Leiste weist sie aus, damit niemand
   * eine Liste für ungefiltert hält, die anderswo gefiltert ist.
   */
  zurueckgehalten: FilterDef[];
  /** Alle Parameter, die „Zurücksetzen" in dieser Ansicht leert. */
  ruecksetzParams: string[];
}

/**
 * Patch fuer „Filter zuruecksetzen" — EIN Ursprung fuer stroeme., karte. und
 * auswertung. (Produktionsfehler 28.09.2026: drei Kopien in den Toolbars
 * leerten je Baum nur den obersten Parameter, `materialart`, `landkreis`,
 * `ort`, `produkt`, `akteur` blieben stehen).
 */
/** Dasselbe aus der reinen Parameterliste — fuer Client-Komponenten, die nur die Liste als Prop bekommen. */
export function ruecksetzPatchAus(ruecksetzParams: readonly string[]): Record<string, null> {
  const patch: Record<string, null> = { q: null };
  for (const p of ruecksetzParams) patch[p] = null;
  return patch;
}

export function ruecksetzPatch(l: Leiste): Record<string, null> {
  // JEDER Parameter jedes geltenden Filters (ruecksetzParams kommt aus dem
  // Modell) plus der Freitext. null loescht den Parameter in useUrlZustand.
  return ruecksetzPatchAus(l.ruecksetzParams);
}

function istGesetzt(def: FilterDef, werte: Record<string, unknown>): boolean {
  return def.params.some((p) => {
    const v = werte[p];
    return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v !== "";
  });
}

/**
 * Leitet die komplette Leiste einer Ansicht aus dem Modell ab — Facetten,
 * Bereiche, Auswahl, Rücksetz-Schlüssel und die zurückgehaltenen Filter.
 * Jede Ansicht ruft diese eine Funktion; handgeschriebene Listen gibt es
 * nicht mehr.
 */
export function leiste(
  ansicht: Ansicht,
  sicht: Sicht,
  werte: Record<string, unknown>,
  optionen: Record<string, FilterOption[]> = {},
): Leiste {
  const geltend = filterFuer(ansicht, sicht);
  const eintrag = (def: FilterDef): LeisteEintrag => ({
    def,
    optionen: optionen[def.key] ?? [],
  });

  const auswahl: Record<string, string[]> = {};
  const bereich: Record<string, string> = {};
  for (const def of geltend) {
    for (const p of def.params) {
      if (def.typ === "facette" || def.typ === "hierarchie") {
        auswahl[p] = (werte[p] as string[]) ?? [];
      } else {
        bereich[p] = (werte[p] as string) ?? "";
      }
    }
  }

  return {
    haupt: geltend.filter((f) => f.gruppe === "haupt").map(eintrag),
    weitere: geltend.filter((f) => f.gruppe === "weitere").map(eintrag),
    auswahl,
    bereich,
    irgendeinFilter: geltend.some((f) => istGesetzt(f, werte)),
    zurueckgehalten: FILTER.filter(
      (f) => !gilt(f, ansicht, sicht) && istGesetzt(f, werte),
    ),
    ruecksetzParams: geltend.flatMap((f) => f.params),
  };
}
