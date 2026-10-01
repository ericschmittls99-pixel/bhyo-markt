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

/** Die Ansichten mit Filterleiste — seit AP2.5 PR a1 auch akteure. (E66). */
export const ANSICHTEN = ["stroeme", "karte", "auswertung", "akteure"] as const;
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
  | "zeitfenster"
  /**
   * E56: Ein Segment-Schalter mit genau einem Parameter und einem
   * benannten Wert („Für mich" = fuer=mich). Kein Chip: Der Schalter steht
   * in der Kopfzeile; im Modell ist er trotzdem ein Filter (E32: Zurücksetzen,
   * Zurückhalten, Export).
   */
  | "schalter";

export interface FilterDef {
  /** Logischer Name; bei einfachen Filtern zugleich der URL-Parameter. */
  key: string;
  label: string;
  typ: FilterTyp;
  /** URL-Parameter dieses Filters — bei `bereich` zwei, sonst einer. */
  params: readonly string[];
  /** In welchen Ansichten er gilt. */
  ansichten: readonly Ansicht[];
  /**
   * Eine Beschriftung fuer denselben Filter in allen Ansichten (E32). Was
   * sich je Ansicht unterscheidet — etwa die Bezugszeit der Verfuegbarkeit —
   * steht im Hinweis (Tooltip und Zeile im Popover), nicht im Namen.
   */
  hinweis?: string;
  hinweisJeAnsicht?: Partial<Record<Ansicht, string>>;
  /**
   * AP2.5 (Entscheidung Eric 01.10.2026): In akteure. filtert die Region den
   * SITZ des Akteurs und heisst dort „Sitz in Region" — die einzige
   * Ansicht, in der dieselbe Facette ein anderes Objekt trifft. Sonst gilt
   * E32: eine Beschriftung fuer alle Ansichten.
   */
  labelJeAnsicht?: Partial<Record<Ansicht, string>>;
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
/** Die drei Strom-Ansichten; akteure. (AP2.5) hat nur die Filter, die am Akteur Sinn ergeben. */
const ALLE_ANSICHTEN: readonly Ansicht[] = ["stroeme", "karte", "auswertung"];

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
    // Stroeme: raeumlich aus dem Strom-Standort (ST_Contains). AP2.5: in akteure.
    // aus dem Sitz des Akteurs — Karte, stroeme. und auswertung. bleiben am Standort.
    ansichten: [...ALLE_ANSICHTEN, "akteure"],
    labelJeAnsicht: { akteure: "Sitz in Region" },
    hinweisJeAnsicht: { akteure: "Region, in der der Sitz des Akteurs liegt — die Ströme behalten ihren Standort" },
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
    // Rückmeldung 2 (Eric, 28.09.2026): „Outputart", nicht „Output" — der
    // Filter meint die Art, nicht den einzelnen Strom.
    label: "Gruppe / Outputart",
    typ: "hierarchie",
    params: ["gruppe", "produkt"],
    ebenen: [
      { param: "gruppe", label: "Gruppen" },
      { param: "produkt", label: "Outputarten" },
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
    // AP2.5: gilt auch in akteure. (dort auf die Akteurliste angewendet, lib/akteure-modell.ts).
    ansichten: [...ALLE_ANSICHTEN, "akteure"],
    arten: BEIDE,
    gruppe: "haupt",
  },
  {
    // AP2.5 PR a1 (E66): die benannten Zustaende eines Akteurs (E24) —
    // unvollstaendig (Sitz ohne Adresse oder Pin), ohne Beleg, verwaist. Nur in
    // akteure.; abgeleitet in lib/akteure-modell.ts, nie gespeichert (E23).
    key: "akteur_zustand",
    label: "Zustand",
    typ: "facette",
    params: ["akteur_zustand"],
    ansichten: ["akteure"],
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
    // E41 (28.09.2026): gilt auch in auswertung. — dort gegen das gewaehlte
    // Jahr bzw. den Zeitraum (E39) statt gegen heute. E52 (Rueckmeldung aus dem
    // Echtbetrieb, 29.09.2026): EINE Beschriftung in allen Ansichten, die
    // Bezugszeit steht im Hinweis — vorher hiess der Filter in auswertung.
    // „Status im gewaehlten Zeitraum" und war dort nicht als derselbe
    // Filter erkennbar.
    hinweis: "bezogen auf heute",
    hinweisJeAnsicht: { auswertung: "bezogen auf das gewählte Jahr bzw. den gewählten Zeitraum" },
    typ: "facette",
    params: ["verfuegbarkeit"],
    ansichten: ALLE_ANSICHTEN,
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
    // E56 (29.09.2026): „Für mich" — von mir gesperrt ODER mir zugewiesen ODER
    // ich bin beteiligt (Protokoll: angelegt, geaendert, status_gesetzt,
    // verworfen; dieselbe Ableitung wie beteiligte() aus AP2.2). Nur in
    // stroeme. und karte.; in auswertung. bleibt er gemerkt und wird als
    // zurueckgehalten ausgewiesen (E32). Betrachter sehen den Schalter nicht.
    key: "fuerMich",
    label: "Für mich",
    typ: "schalter",
    params: ["fuer"],
    ansichten: ["stroeme", "karte"],
    arten: BEIDE,
    gruppe: "haupt",
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
    // E62 (AP2.4): die benannten Verifikationszustaende (ungeprueft, in
    // Pruefung, gueltig, abgelaufen, als abgelaufen markiert, Pruefdatum
    // unbekannt) aus strom_verifikation(). Loeste den E33-Filter
    // „Verifizierung" (Gesamtfaelligkeit) ab; Verfuegbarkeitsende, Vergaben und
    // das Reservierungsveralten (E64) gehoeren zum Verfuegbarkeits-Filter.
    // Gilt auch in auswertung. (das Modul zeigt die drei naechsten).
    key: "verifikation",
    label: "Verifikation",
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

/** Beschriftung eines Filters in einer Ansicht (E41: je Ansicht abweichend moeglich). */
export function filterLabel(def: FilterDef, ansicht: Ansicht): string {
  // Eine Beschriftung fuer alle Ansichten (E32) — Ausnahme nur, wo der Filter ein anderes Objekt trifft (akteure., Sitz).
  return def.labelJeAnsicht?.[ansicht] ?? def.label;
}

/** Hinweis zum Filter in dieser Ansicht (Tooltip und Popover-Zeile), z. B. die Bezugszeit. */
export function filterHinweis(def: FilterDef, ansicht: Ansicht): string | undefined {
  return def.hinweisJeAnsicht?.[ansicht] ?? def.hinweis;
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
  /**
   * Felder des Popovers „Weitere Filter" (Bereiche, Monate, Datum,
   * Zeitfenster) in Anzeigereihenfolge — siehe BEREICH_REIHENFOLGE. Vorher
   * rechneten drei Seiten dieselbe Liste aus den Einträgen nach.
   */
  bereichParams: string[];
}

/**
 * Reihenfolge im Popover „Weitere Filter" (Rückmeldung 1, Eric 28.09.2026):
 * Zeile 1 „Verfügbar ab" | „Erstellt am", Zeile 2 „Vollständigkeit min/max".
 * Alles Übrige folgt danach in der Reihenfolge des Modells. Das Popover ist
 * zweispaltig; die Paare bleiben deshalb zusammen.
 */
export const BEREICH_REIHENFOLGE: readonly string[] = ["vonAb", "erstellt", "vollMin", "vollMax"];

function bereichParamsVon(geltend: FilterDef[]): string[] {
  const alle = geltend
    .filter((f) => !["facette", "hierarchie", "text", "schalter"].includes(f.typ))
    .flatMap((f) => f.params);
  const vorn = BEREICH_REIHENFOLGE.filter((p) => alle.includes(p));
  return [...vorn, ...alle.filter((p) => !vorn.includes(p))];
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
      } else if (def.typ !== "schalter") {
        // E56: Schalter stehen in der Kopfzeile, nicht in der Filterzeile —
        // sie zaehlen nicht zur Filter-Pille, wohl aber zu irgendeinFilter.
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
    bereichParams: bereichParamsVon(geltend),
  };
}
