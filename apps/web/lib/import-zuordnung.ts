import { dezimalKanonisch, istMehrdeutig, monatKanonisch } from "@/lib/eingabe-format";
import { monatZuBis } from "@/lib/formular-modell";
import { IGNORIEREN, PERSON } from "@/lib/import-konstanten";
import { istPersonenSchluessel } from "@/lib/import-modell";
import type { StromArt } from "@/lib/stroeme-modell";

/**
 * AP2.7 PR b (E67): Spalten- und Werte-Zuordnung — reine Regeln. Zielfelder
 * sind die FormData-Schluessel des Erfassungsformulars (strom-schreibweg.ts,
 * akteur-eingabe.ts mit Praefix akteur_), damit der Probelauf jede Zeile
 * durch dieselben Bausteine schickt wie das Formular. Personen-Spalten
 * werden erkannt oder markiert und nie in `felder` uebernommen.
 */

export type ZielTyp = "text" | "zahl" | "monat" | "datum" | "einheit" | "code";

/** E75: Wert von „Zeitraum bis" fuer ein offenes Ende (aus den Woertern unten); wird zu zeitraum_bis NULL. */
export const UNBEFRISTET = "unbefristet";
export const UNBEFRISTET_WOERTER: ReadonlySet<string> = new Set(["unbefristet", "offen", "unbegrenzt"]);
export type WerteListe = "materialart" | "produkt" | "sektor" | "beleg_typ" | "menge_einheit" | "preis_bezug";

export interface Zielfeld {
  key: string;
  label: string;
  gruppe: "akteur" | "strom" | "beleg";
  arten: readonly StromArt[];
  /** Pflicht im Formular: ohne Zuordnung scheitert jede Zeile — die Zuordnung weist das vorher ab. */
  pflicht: boolean;
  typ: ZielTyp;
  werte?: WerteListe;
  /** PR f: Code wird aus dem Spaltenwert gerechnet (Einheiten bei Bedarfen), nicht von Hand zugeordnet. */
  auto?: boolean;
  /** PR f (E20): Menge in ganzen Einheiten — Nachkommastellen werden gerundet, mit Hinweis an der Zeile. */
  menge?: boolean;
  /** PR f: ein Monat als Datum — „anfang" = Monatserster, „ende" = Monatsletzter (Weggabelung 8). */
  grenze?: "anfang" | "ende";
  synonyme: readonly string[];
}

/**
 * PR f (B3): Zuordnungs- und Lesefehler bleiben an der Zeile — je Zielfeld ein
 * Schluessel `fehler_<key>` in felder; Hinweise (Rundung, Umrechnung, Monat als
 * Datum) als `hinweis_<key>`. Beides sind keine Zielfelder und erreichen nie
 * das Formular (formDataAusZeile nimmt nur Zielfelder der Gruppe strom).
 */
export const FEHLER_PREFIX = "fehler_";
export const HINWEIS_PREFIX = "hinweis_";
/** PR f (Weggabelung 7): die Zeile ist die exakte Doppelzeile der genannten Zeile derselben Datei. */
export const DOPPEL_VON = "doppel_von";

export { IGNORIEREN, PERSON };

const BEIDE: readonly StromArt[] = ["biomasse", "output"];

export const ZIELFELDER: readonly Zielfeld[] = [
  // Akteur (E66): Name Pflicht; PLZ, Ort und Pin braucht ein NEUER Akteur — ohne Treffer beim Aufloesen landet die Zeile in der Nacharbeit.
  { key: "akteur_name", label: "Akteur · Name", gruppe: "akteur", arten: BEIDE, pflicht: true, typ: "text", synonyme: ["akteur", "akteur name", "akteurname", "name", "betrieb", "betriebsname", "betrieb firma", "firma betrieb", "firma", "firmenname", "unternehmen", "organisation", "anbieter", "lieferant", "abnehmer", "kunde", "erzeuger"] },
  { key: "akteur_sektor", label: "Akteur · Sektor", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "code", werte: "sektor", synonyme: ["sektor", "branche", "wirtschaftszweig", "sparte"] },
  { key: "akteur_sitz_strasse", label: "Akteur · Sitz Straße", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["strasse", "str", "sitz strasse", "adresse"] },
  { key: "akteur_sitz_hausnummer", label: "Akteur · Sitz Hausnummer", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["hausnummer", "hausnr", "haus nr", "hnr", "nr", "sitz hausnummer"] },
  { key: "akteur_sitz_plz", label: "Akteur · Sitz PLZ", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["plz", "postleitzahl", "sitz plz"] },
  { key: "akteur_sitz_ort", label: "Akteur · Sitz Ort", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["ort", "stadt", "gemeinde", "sitz ort"] },
  // Strom — Feedstock. PR e (Eric 07.10.2026): TS-Anteil und Aschegehalt sind keine
  // Pflicht mehr — ohne Spalte oder Wert bleiben sie „unbekannt" (Strom unvollstaendig,
  // nie „geprueft"); Zeitraum von/bis ohne Spalte oder Wert kommt vom Lauf.
  { key: "materialart_code", label: "Materialart", gruppe: "strom", arten: ["biomasse"], pflicht: true, typ: "code", werte: "materialart", synonyme: ["materialart", "material", "stoff", "substrat", "biomasse", "einsatzstoff", "reststoff"] },
  { key: "menge_roh_fm", label: "Menge (t FM/a)", gruppe: "strom", arten: ["biomasse"], pflicht: true, typ: "zahl", menge: true, synonyme: ["menge", "menge fm", "menge frischmasse", "rohmenge", "rohmenge t a", "jahresmenge", "jahresmenge t", "jahresmenge t a", "tonnen", "tonnen pro jahr", "t a", "t fm a", "menge t", "menge in t", "menge in t a", "menge t a", "menge t fm", "menge t fm a", "menge fm t a"] },
  { key: "menge_einheit_fm", label: "Einheit der Menge (t/kg je Jahr/Monat)", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "einheit", synonyme: ["einheit", "mengeneinheit", "einheit menge", "einheit der menge"] },
  { key: "ts_anteil_pct", label: "TS-Anteil %", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["ts", "ts anteil", "ts anteil %", "ts %", "trockensubstanz", "trockensubstanz %", "tm %", "ts gehalt"] },
  { key: "aschegehalt_pct", label: "Aschegehalt %", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["asche", "aschegehalt", "aschegehalt %", "asche %"] },
  { key: "preis_min", label: "Preis min €/t", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["preis min", "preis von", "min preis"] },
  { key: "preis_mittel", label: "Preis mittel €/t", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["preis", "preis mittel", "mittelpreis", "preis t", "preis je t", "preis pro t", "preis t fm", "preis eur t"] },
  { key: "preis_max", label: "Preis max €/t", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["preis max", "preis bis", "max preis"] },
  // E69: Bezug des Preises aus einer Spalte (Werte-Zuordnung fm/atro); ohne Spalte gilt der Lauf-Standard (import_lauf.preis_bezug_standard).
  { key: "preis_bezug", label: "Preis-Bezug (FM / atro)", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "code", werte: "preis_bezug", synonyme: ["preis bezug", "preisbezug", "bezug", "preisbasis", "bezug preis", "preis einheit"] },
  // Strom — Bedarf
  { key: "produkt_code", label: "Produkt", gruppe: "strom", arten: ["output"], pflicht: true, typ: "code", werte: "produkt", synonyme: ["produkt", "output", "output produkt", "produktart", "bedarfsart", "energietraeger"] },
  // PR f (B6): „Bedarf" ist die Menge, nicht das Produkt (Testdatei, Blatt Bedarfe).
  { key: "menge_wert", label: "Menge", gruppe: "strom", arten: ["output"], pflicht: true, typ: "zahl", menge: true, synonyme: ["menge", "bedarf", "bedarfsmenge", "bedarf menge", "menge bedarf", "jahresmenge", "jahresbedarf", "menge mwh", "menge mwh a", "menge t a", "bedarf mwh a", "bedarf t a"] },
  // PR f (Weggabelung 9): die Einheit wird gelesen und umgerechnet (kg/t, kWh/MWh/GWh, Nm³ je Jahr oder Monat), nicht je Wert zugeordnet.
  { key: "menge_einheit", label: "Einheit der Menge (t/a, MWh/a, Nm³/a)", gruppe: "strom", arten: ["output"], pflicht: true, typ: "code", werte: "menge_einheit", auto: true, synonyme: ["einheit", "mengeneinheit", "einheit menge", "einheit der menge"] },
  { key: "preis", label: "Preis", gruppe: "strom", arten: ["output"], pflicht: false, typ: "zahl", synonyme: ["preis", "preis mwh", "preis t"] },
  // Strom — beide
  { key: "zeitraum_von", label: "Zeitraum von (MM/JJJJ)", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "monat", synonyme: ["zeitraum von", "von", "ab", "beginn", "start", "verfuegbar ab", "von monat"] },
  { key: "zeitraum_bis", label: "Zeitraum bis (MM/JJJJ)", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "monat", synonyme: ["zeitraum bis", "bis", "ende", "verfuegbar bis", "bis monat"] },
  { key: "bezeichnung", label: "Bezeichnung", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["bezeichnung", "beschreibung", "titel", "bemerkung"] },
  { key: "strasse", label: "Standort · Straße", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort strasse", "standort str"] },
  { key: "hausnummer", label: "Standort · Hausnummer", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort hausnummer", "standort nr"] },
  { key: "plz", label: "Standort · PLZ", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort plz"] },
  { key: "ort", label: "Standort · Ort", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort ort", "standort"] },
  { key: "lat", label: "Standort · Breite", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "zahl", synonyme: ["lat", "latitude", "breite", "breitengrad"] },
  { key: "lng", label: "Standort · Länge", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "zahl", synonyme: ["lng", "lon", "longitude", "laenge", "laengengrad"] },
  // Beleg: der Typ je Lauf ist Pflicht; eine Spalte darf ihn je Zeile ueberschreiben.
  { key: "beleg_typ", label: "Belegtyp (überschreibt den des Laufs)", gruppe: "beleg", arten: BEIDE, pflicht: false, typ: "code", werte: "beleg_typ", synonyme: ["belegtyp", "beleg typ", "beleg", "quelle", "quellenart", "nachweis"] },
  // Eric 06.10.2026: eine zugeordnete Spalte geht dem Lauf-Wert je Zeile vor.
  { key: "beleg_erhebungsdatum", label: "Erhebungsdatum des Belegs (überschreibt den Lauf-Wert)", gruppe: "beleg", arten: BEIDE, pflicht: false, typ: "datum", grenze: "anfang", synonyme: ["erhebungsdatum", "erhoben am", "stand", "datum", "erhebung"] },
  { key: "beleg_gueltig_bis", label: "Beleg gültig bis (überschreibt den Lauf-Wert)", gruppe: "beleg", arten: BEIDE, pflicht: false, typ: "datum", grenze: "ende", synonyme: ["gueltig bis", "gültig bis", "beleg gueltig bis", "laufzeit bis", "gueltigkeit"] },
];

const ZIEL_NACH_KEY = new Map(ZIELFELDER.map((z) => [z.key, z]));
export function zielfeld(key: string): Zielfeld | undefined {
  return ZIEL_NACH_KEY.get(key);
}
export function zielfelderFuer(art: StromArt): Zielfeld[] {
  return ZIELFELDER.filter((z) => z.arten.includes(art));
}

/** Normalform fuer Vergleiche: klein, Umlaute aufgeloest, nur Buchstaben/Ziffern/%, einfache Leerzeichen. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Laufende Nummern (PR f, B6): werden ignoriert, nie als Hausnummer gedeutet. */
const LAUFENDE_NUMMER = new Set(["lfd nr", "lfd", "laufende nummer", "pos", "position"]);
const STRASSE_SYNONYME = new Set(zielfeld("akteur_sitz_strasse")!.synonyme.map(normName));

/**
 * Spaltenname → Zielfeld-Key, PERSON, IGNORIEREN oder "" (keine Idee — der
 * Mensch entscheidet). PR f (B6, Eric 07.10.2026): „Nr" ist nur direkt nach
 * einer Straßen-Spalte die Hausnummer, sonst die laufende Nummer (ignoriert);
 * „Hausnr."/„Hausnummer" nur, wenn die Datei auch eine Straße hat.
 */
export function vorschlagZuordnung(art: StromArt, spalten: readonly string[]): Record<string, string> {
  const vergeben = new Set<string>();
  const zuordnung: Record<string, string> = {};
  const hatStrasse = spalten.some((sp) => STRASSE_SYNONYME.has(normName(sp.replace(/\s*\(\d+\)$/, ""))));
  let vorheriges = "";
  for (const sp of spalten) {
    if (istPersonenSchluessel(sp)) {
      zuordnung[sp] = PERSON;
      vorheriges = PERSON;
      continue;
    }
    const n = normName(sp.replace(/\s*\(\d+\)$/, ""));
    if (LAUFENDE_NUMMER.has(n)) {
      zuordnung[sp] = IGNORIEREN;
      vorheriges = IGNORIEREN;
      continue;
    }
    let treffer = zielfelderFuer(art).find((z) => !vergeben.has(z.key) && z.synonyme.some((syn) => normName(syn) === n));
    if (treffer?.key === "akteur_sitz_hausnummer") {
      if (n === "nr") {
        if (vorheriges !== "akteur_sitz_strasse") {
          zuordnung[sp] = IGNORIEREN;
          vorheriges = IGNORIEREN;
          continue;
        }
      } else if (!hatStrasse) treffer = undefined;
    }
    zuordnung[sp] = treffer?.key ?? "";
    vorheriges = zuordnung[sp];
    if (treffer) vergeben.add(treffer.key);
  }
  return zuordnung;
}

export interface Zuordnung {
  /** Spaltenname → Zielfeld-Key | PERSON | IGNORIEREN | "" */
  spalten: Record<string, string>;
  /** Zielfeld-Key (typ code) → Spaltenwert → Code ("" = nicht zugeordnet) */
  werte: Record<string, Record<string, string>>;
}

/** Wird vor dem Speichern geprueft; jede Meldung nennt, was fehlt. */
export function pruefeZuordnung(art: StromArt, spalten: readonly string[], z: Zuordnung): string[] {
  const fehler: string[] = [];
  const belegt = new Map<string, string>();
  for (const sp of spalten) {
    const ziel = z.spalten[sp] ?? "";
    if (ziel === "" || ziel === PERSON || ziel === IGNORIEREN) continue;
    const def = zielfeld(ziel);
    // Personen zuerst: Wer „E-Mail" als Zielfeld eintraegt, soll den Grund lesen, nicht „unbekannt".
    if (istPersonenSchluessel(ziel)) fehler.push(`Spalte „${sp}": Personen-Daten werden nicht übernommen.`);
    else if (!def || !def.arten.includes(art)) fehler.push(`Spalte „${sp}": unbekanntes Zielfeld „${ziel}".`);
    else if (belegt.has(ziel)) fehler.push(`Zielfeld „${def.label}" ist doppelt zugeordnet (Spalten „${belegt.get(ziel)}" und „${sp}").`);
    else belegt.set(ziel, sp);
  }
  const fehlend = zielfelderFuer(art).filter((d) => d.pflicht && !belegt.has(d.key));
  if (fehlend.length > 0) {
    fehler.push(`Pflichtfelder ohne Spalte: ${fehlend.map((d) => d.label).join(", ")} — ohne sie würde jede Zeile scheitern.`);
  }
  return fehler;
}

/**
 * Eine Vorlage traegt die Zuordnung ohne Datei und ohne Art: geprueft wird
 * nur, dass jedes Ziel ein bekanntes Zielfeld, PERSON oder IGNORIEREN ist und
 * kein Personen-Schluessel. Pflichtfelder prueft erst die Anwendung auf eine
 * Datei (pruefeZuordnung).
 */
export function pruefeVorlage(z: Zuordnung): string[] {
  const fehler: string[] = [];
  for (const [sp, ziel] of Object.entries(z.spalten)) {
    if (ziel === "" || ziel === PERSON || ziel === IGNORIEREN) continue;
    if (istPersonenSchluessel(ziel)) fehler.push(`Spalte „${sp}": Personen-Daten werden nicht übernommen.`);
    else if (!zielfeld(ziel)) fehler.push(`Spalte „${sp}": unbekanntes Zielfeld „${ziel}".`);
  }
  for (const key of Object.keys(z.werte)) {
    if (zielfeld(key)?.typ !== "code") fehler.push(`Werte-Zuordnung für „${key}" — kein Code-Zielfeld.`);
  }
  return fehler;
}

/**
 * Vorlage auf die Spalten einer Datei anwenden: gleiche Spaltennamen
 * (Normalform) bekommen das Ziel der Vorlage, Personen-Spalten bleiben
 * erkannt, alle anderen den Vorschlag. Werte der Vorlage ueberdecken den
 * Werte-Vorschlag, wo der Spaltenwert vorkommt.
 */
export function vorlageAnwenden(
  vorlage: Zuordnung,
  spalten: readonly string[],
  vorschlag: Record<string, string>,
  werteVorschlagAlt: Record<string, Record<string, string>>,
): Zuordnung {
  const nachNorm = new Map(Object.entries(vorlage.spalten).map(([sp, ziel]) => [normName(sp), ziel]));
  const neu: Record<string, string> = {};
  const vergeben = new Set<string>();
  for (const sp of spalten) {
    if (vorschlag[sp] === PERSON) {
      neu[sp] = PERSON;
      continue;
    }
    const ziel = nachNorm.get(normName(sp));
    if (ziel !== undefined && ziel !== "" && !(zielfeld(ziel) && vergeben.has(ziel))) {
      neu[sp] = ziel;
      if (zielfeld(ziel)) vergeben.add(ziel);
    } else neu[sp] = "";
  }
  // Was die Vorlage nicht kennt, behaelt den Vorschlag — sofern das Ziel noch frei ist.
  for (const sp of spalten) {
    const v = vorschlag[sp] ?? "";
    if (neu[sp] === "" && v !== "" && !vergeben.has(v)) {
      neu[sp] = v;
      if (zielfeld(v)) vergeben.add(v);
    }
  }
  const werte: Record<string, Record<string, string>> = {};
  for (const [key, map] of Object.entries(werteVorschlagAlt)) {
    werte[key] = { ...map };
    for (const [wert, code] of Object.entries(vorlage.werte[key] ?? {})) if (wert in werte[key]! && code) werte[key]![wert] = code;
  }
  return { spalten: neu, werte };
}

/** Vorschlag der Werte-Zuordnung: Spaltenwert → Code, wenn Label oder Code in Normalform gleich sind. */
export function werteVorschlag(werte: readonly string[], optionen: readonly { code: string; label: string }[]): Record<string, string> {
  const nachNorm = new Map<string, string>();
  for (const o of optionen) {
    nachNorm.set(normName(o.label), o.code);
    nachNorm.set(normName(o.code), o.code);
  }
  const erg: Record<string, string> = {};
  for (const w of werte) erg[w] = nachNorm.get(normName(w)) ?? "";
  return erg;
}

/** Verschiedene nicht-leere Werte einer Spalte mit Haeufigkeit, haeufigste zuerst. */
export function spaltenWerte(zeilen: readonly string[][], index: number, max = 200): { wert: string; anzahl: number }[] {
  const zaehl = new Map<string, number>();
  for (const z of zeilen) {
    const w = (z[index] ?? "").trim();
    if (w) zaehl.set(w, (zaehl.get(w) ?? 0) + 1);
  }
  return [...zaehl.entries()]
    .map(([wert, anzahl]) => ({ wert, anzahl }))
    .sort((a, b) => b.anzahl - a.anzahl || a.wert.localeCompare(b.wert, "de"))
    .slice(0, max);
}

const ZEIT_MONAT = /^(monat|mon|m|mtl)$/;
const ZEIT = "(a|jahr|j|pa|monat|mon|m|mtl)";

/**
 * E67: Mengen nur t FM/a. Eine Einheitenspalte darf t oder kg und pro Jahr
 * oder pro Monat enthalten — ohne Annahme umrechenbar. Alles andere,
 * insbesondere TM/atro, ist ein Zeilenfehler. Leer heisst t/a. PR f (B4,
 * Eric 07.10.2026): „t" ohne Zeitbezug ist mehrdeutig (Leitregel) — Fehler.
 */
export function einheitFaktor(text: string): { faktor: number } | { fehler: string } {
  const t = text.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
  if (t === "") return { faktor: 1 };
  if (/(tm|atro|trocken|ts\b|ots)/.test(t)) return { fehler: `Einheit „${text}" bezieht sich auf Trockenmasse — erwartet wird Frischmasse (t FM/a).` };
  const m = new RegExp(`^(t|to|tonne|tonnen|kg|kilogramm)(fm|frischmasse)?(?:\\/|pro|je|p)?${ZEIT}?$`).exec(t);
  if (!m) return { fehler: `Einheit „${text}" ist nicht umrechenbar — erlaubt sind t oder kg je Jahr oder Monat.` };
  if (!m[3]) return { fehler: `Einheit „${text}" ohne Zeitbezug ist mehrdeutig — erwartet t/a oder t/Monat (mehrdeutig wird abgewiesen, nicht geraten).` };
  const masse = m[1]!.startsWith("k") ? 0.001 : 1;
  const zeit = ZEIT_MONAT.test(m[3]) ? 12 : 1;
  return { faktor: masse * zeit };
}

/**
 * PR f (Weggabelung 9, Eric 07.10.2026): Einheiten bei Bedarfen — definierte
 * Umrechnungen ohne Annahme: kg/t → t/a, kWh/MWh/GWh → MWh/a, Nm³ → Nm³/a,
 * je Jahr oder Monat. Alles andere (auch leer oder ohne Zeitbezug) ist ein Fehler.
 */
export function einheitOutput(text: string): { code: string; faktor: number } | { fehler: string } {
  const t = text.toLowerCase().replace(/\s+/g, "").replace(/\./g, "").replace(/³/g, "3");
  if (t === "") return { fehler: "Einheit fehlt — erwartet t/a, MWh/a oder Nm³/a (auch kg, kWh, GWh, je Monat)." };
  const m = new RegExp(`^(t|to|tonne|tonnen|kg|kilogramm|kwh|mwh|gwh|nm3|m3n)(?:\\/|pro|je|p)?${ZEIT}?$`).exec(t);
  if (!m) return { fehler: `Einheit „${text}" ist nicht umrechenbar — erlaubt sind kg/t, kWh/MWh/GWh und Nm³ je Jahr oder Monat.` };
  if (!m[2]) return { fehler: `Einheit „${text}" ohne Zeitbezug ist mehrdeutig — erwartet z. B. t/a oder MWh/a.` };
  const e = m[1]!;
  const basis = e === "kwh" ? { code: "MWh/a", faktor: 0.001 } : e === "mwh" ? { code: "MWh/a", faktor: 1 } : e === "gwh" ? { code: "MWh/a", faktor: 1000 } : e === "nm3" || e === "m3n" ? { code: "Nm³/a", faktor: 1 } : e.startsWith("k") ? { code: "t/a", faktor: 0.001 } : { code: "t/a", faktor: 1 };
  return { code: basis.code, faktor: basis.faktor * (ZEIT_MONAT.test(m[2]) ? 12 : 1) };
}

/**
 * PR f (B8, Eric 07.10.2026): Textzahlen im deutschen Format — Punkt ist
 * Tausender, Komma Dezimal. Was im Formular mehrdeutig waere („1.200", E31)
 * ist im Import nach dieser Regel eindeutig 1200; ein Punkt ohne
 * Dreiergruppe bleibt Dezimalpunkt (wie dezimalKanonisch). Gemischt
 * englisch („1,234.5") und alles Nicht-Numerische („ca. 3000", „50-80") ist
 * ein Fehler — es wird nicht geraten.
 */
export function zahlAusText(text: string): { wert: number } | { fehler: string } {
  const t = text.trim().replace(/[\s\u00a0\u202f]/g, "");
  const fehler = { fehler: `„${text.trim()}" ist keine Zahl (erwartet deutsches Format, z. B. 1.234,5).` };
  if (t === "" || /,\d*\./.test(t)) return fehler;
  const kanon = istMehrdeutig(t) ? t.replace(/\./g, "") : dezimalKanonisch(t);
  if (!/^-?\d+(\.\d+)?$/.test(kanon)) return fehler;
  return { wert: Number(kanon) };
}

const DE = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 6 });
/** Zahl fuer Hinweise: deutsches Format (1.234,5). */
export function zahlAnzeige(n: number): string {
  return DE.format(n);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Telefon: +Laendervorwahl oder fuehrende 0, danach mindestens sechs weitere Ziffern mit ueblichen Trennern.
const TELEFON = /(?:\+\d{1,3}|(?<!\d)0\d{1,4})[\s\-\/().]*\d(?:[\s\-\/().]*\d){5,}/;

/** PR f (B5, DSGVO): E-Mail-Adresse oder Telefonnummer im Text — nach Muster, Personennamen treffen nicht. */
export function enthaeltKontaktdaten(text: string): boolean {
  return EMAIL.test(text) || TELEFON.test(text);
}
export const KONTAKTDATEN_HINWEIS = "enthält Kontaktdaten, bitte entfernen";
const KONTAKTDATEN_ERSATZ = "[Kontaktdaten entfernt]";

/** Zahl in Speicherform (ohne Rundung) → Text mit Komma, wie getippt. */
export function zahlText(n: number): string {
  return String(n).replace(".", ",");
}

export type WertErgebnis = { wert: string; hinweis?: string } | { fehler: string };

const DATUM_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATUM_DE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

/** Monat aus Spaltentext: MM/JJJJ & Co. oder JJJJ-MM → JJJJ-MM; eine Datumszelle wird zum Monat mit Hinweis; Freitext ist ein Fehler (PR f). */
export function monatAusText(text: string): WertErgebnis {
  const t = text.trim();
  if (t === "") return { wert: "" };
  const d = DATUM_ISO.exec(t) ?? (() => {
    const de = DATUM_DE.exec(t);
    return de ? [t, de[3]!, de[2]!.padStart(2, "0"), de[1]!.padStart(2, "0")] : null;
  })();
  if (d) return { wert: `${d[1]}-${d[2]}`, hinweis: `Datum „${t}" als Monat ${d[2]}/${d[1]} übernommen.` };
  const m = monatKanonisch(t);
  if (m) return { wert: m };
  return { fehler: `„${t}" ist kein Monat (erwartet MM/JJJJ).` };
}

/**
 * Datum aus Spaltentext: JJJJ-MM-TT (auch aus Datumszellen) oder TT.MM.JJJJ.
 * PR f (Weggabelung 8): ein Monat (JJJJ-MM, MM/JJJJ) wird am Anfang zum
 * Monatsersten, am Ende zum Monatsletzten — mit Hinweis. Freitext ist ein Fehler.
 */
export function datumAusText(text: string, grenze: "anfang" | "ende"): WertErgebnis {
  const t = text.trim();
  if (t === "") return { wert: "" };
  if (DATUM_ISO.test(t)) return { wert: t };
  const de = DATUM_DE.exec(t);
  if (de) return { wert: `${de[3]}-${de[2]!.padStart(2, "0")}-${de[1]!.padStart(2, "0")}` };
  const m = monatKanonisch(t);
  if (m) {
    const wert = grenze === "anfang" ? `${m}-01` : monatZuBis(m);
    return { wert, hinweis: `Monat „${t}" als ${grenze === "anfang" ? "Monatserster" : "Monatsletzter"} ${wert} übernommen.` };
  }
  return { fehler: `„${t}" ist kein Datum (erwartet TT.MM.JJJJ oder JJJJ-MM-TT).` };
}

/** Menge in ganzen Einheiten (E20): Rundung mit Hinweis; sonst unveraendert. */
function mengeRunden(n: number, roh: string, einheit: string): { wert: number; hinweis?: string } {
  const g = Math.round(n);
  if (g === n) return { wert: n };
  return { wert: g, hinweis: `Menge „${roh}" auf ${zahlAnzeige(g)} ${einheit} gerundet (E20: ganze Einheiten).` };
}

/**
 * PR f: ein Feldwert nach den Regeln seines Zielfelds — Zahl (deutsch), Menge
 * (gerundet), Monat, Datum, Text ohne Kontaktdaten. Dieselbe Funktion fuer
 * Zuordnung und Nacharbeit; Codes und Einheiten behandeln die Aufrufer.
 */
export function feldWert(def: Zielfeld, roh: string): WertErgebnis {
  const wert = roh.trim();
  switch (def.typ) {
    case "zahl": {
      if (wert === "") return { wert: "" };
      const z = zahlAusText(wert);
      if ("fehler" in z) return z;
      if (def.menge) {
        const r = mengeRunden(z.wert, wert, def.key === "menge_roh_fm" ? "t FM/a" : "");
        return { wert: zahlText(r.wert), ...(r.hinweis ? { hinweis: r.hinweis } : {}) };
      }
      return { wert: zahlText(z.wert) };
    }
    case "monat":
      // E75: „Zeitraum bis" darf ausdruecklich offen sein — nur diese Woerter, nie eine leere Zelle.
      if (def.key === "zeitraum_bis" && UNBEFRISTET_WOERTER.has(wert.trim().toLowerCase())) return { wert: UNBEFRISTET };
      return monatAusText(wert);
    case "datum":
      return datumAusText(wert, def.grenze ?? "anfang");
    default:
      if (enthaeltKontaktdaten(wert)) return { fehler: KONTAKTDATEN_HINWEIS };
      return { wert };
  }
}

/** Fehler-Schluessel → Meldung mit Label, in der Reihenfolge der Zielfelder; null ohne Fehler. */
export function zuordnungsFehlerListe(felder: Record<string, string>): string[] {
  return ZIELFELDER.filter((z) => felder[`${FEHLER_PREFIX}${z.key}`]).map((z) => `${z.label}: ${felder[`${FEHLER_PREFIX}${z.key}`]}`);
}
export function zuordnungsFehler(felder: Record<string, string>): string | null {
  const l = zuordnungsFehlerListe(felder);
  return l.length > 0 ? l.join(" · ") : null;
}
/** Hinweise an der Zeile, in der Reihenfolge der Zielfelder, Doppelzeilen-Hinweis zuletzt. */
export function hinweise(felder: Record<string, string>): string[] {
  const h = ZIELFELDER.filter((z) => felder[`${HINWEIS_PREFIX}${z.key}`]).map((z) => felder[`${HINWEIS_PREFIX}${z.key}`]!);
  if (felder[`${HINWEIS_PREFIX}doppelzeile`]) h.push(felder[`${HINWEIS_PREFIX}doppelzeile`]!);
  return h;
}

export interface ZeileErgebnis {
  /** Nur zugeordnete Zielfelder, nie Personen-Schluessel. */
  felder: Record<string, string>;
  /** Erster Fehler, der die Zeile scheitern laesst, sonst null. */
  fehlergrund: string | null;
}

/**
 * Eine Datenzeile → Zielfelder. Codes werden ueber die Werte-Zuordnung
 * aufgeloest, Zahlen deutsch gelesen, Mengen ueber die Einheit umgerechnet
 * und gerundet (E20), Monate und Daten kanonisiert, Texte mit Kontaktdaten
 * nicht uebernommen (B5). PR f (B3): jeder Fehler bleibt als
 * `fehler_<key>` an der Zeile, jeder Hinweis als `hinweis_<key>`; der erste
 * Fehler ist der fehlergrund. Probelauf und Ausfuehren pruefen die Fehler-
 * Schluessel und setzen nie „ok", solange einer da ist.
 */
export function zeileZuFelder(spalten: readonly string[], zeile: readonly string[], z: Zuordnung): ZeileErgebnis {
  const felder: Record<string, string> = {};
  const fehler: string[] = [];
  const einheiten: Record<string, string> = {};
  const roh: Record<string, string> = {};
  const setzeFehler = (def: Zielfeld, text: string) => {
    felder[`${FEHLER_PREFIX}${def.key}`] = text;
    fehler.push(`${def.label}: ${text}`);
  };
  for (let i = 0; i < spalten.length; i++) {
    const sp = spalten[i]!;
    const ziel = z.spalten[sp] ?? "";
    if (ziel === "" || ziel === PERSON || ziel === IGNORIEREN) continue;
    const def = zielfeld(ziel);
    if (!def || istPersonenSchluessel(ziel)) continue;
    const wert = (zeile[i] ?? "").trim();
    roh[ziel] = wert;
    if (def.typ === "einheit" || (def.typ === "code" && def.auto)) {
      einheiten[ziel] = wert;
      continue;
    }
    if (def.typ === "code") {
      if (wert === "") {
        felder[ziel] = "";
        continue;
      }
      const code = z.werte[ziel]?.[wert] ?? "";
      if (code === "") setzeFehler(def, `Wert „${wert}" ist keinem Code zugeordnet.`);
      felder[ziel] = code;
      continue;
    }
    // Mengen: erst die Einheit, dann die Rundung — deshalb hier ungerundet (siehe unten).
    const e: WertErgebnis = def.menge && wert !== "" ? (() => { const z2 = zahlAusText(wert); return "fehler" in z2 ? z2 : { wert: zahlText(z2.wert) }; })() : feldWert(def, wert);
    if ("fehler" in e) {
      // B5: der Wert mit Kontaktdaten wird nicht uebernommen; andere Rohwerte bleiben zur Korrektur stehen.
      if (e.fehler !== KONTAKTDATEN_HINWEIS) felder[ziel] = wert;
      setzeFehler(def, e.fehler);
      continue;
    }
    felder[ziel] = e.wert;
    if (e.hinweis) felder[`${HINWEIS_PREFIX}${def.key}`] = e.hinweis;
  }
  // Mengen ueber die Einheit: Umrechnung vor der Rundung, Hinweis nennt beides.
  const menge = (key: string, einheitText: string, umrechnung: { faktor: number; ziel: string } | { fehler: string }) => {
    const def = zielfeld(key)!;
    if (`${FEHLER_PREFIX}${key}` in felder) return;
    if ("fehler" in umrechnung) {
      setzeFehler(def, umrechnung.fehler);
      return;
    }
    const rohText = roh[key] ?? "";
    if (rohText === "") return;
    const n = Number(dezimalKanonisch(felder[key] ?? ""));
    if (!Number.isFinite(n)) return;
    const umgerechnet = n * umrechnung.faktor;
    const r = mengeRunden(umgerechnet, `${rohText} ${einheitText}`.trim(), umrechnung.ziel);
    felder[key] = zahlText(r.wert);
    const h: string[] = [];
    if (umrechnung.faktor !== 1) h.push(`Menge „${rohText} ${einheitText}" als ${zahlAnzeige(umgerechnet)} ${umrechnung.ziel} übernommen.`);
    if (r.hinweis) h.push(r.hinweis);
    if (h.length > 0) felder[`${HINWEIS_PREFIX}${key}`] = h.join(" ");
    else delete felder[`${HINWEIS_PREFIX}${key}`];
  };
  if ("menge_roh_fm" in roh) {
    const e = einheitFaktor(einheiten.menge_einheit_fm ?? "");
    menge("menge_roh_fm", einheiten.menge_einheit_fm ?? "", "fehler" in e ? e : { faktor: e.faktor, ziel: "t FM/a" });
  }
  if ("menge_einheit" in einheiten) {
    const e = einheitOutput(einheiten.menge_einheit ?? "");
    if ("fehler" in e) {
      felder.menge_einheit = "";
      setzeFehler(zielfeld("menge_einheit")!, e.fehler);
      if ("menge_wert" in roh) menge("menge_wert", "", { faktor: 1, ziel: "" });
    } else {
      felder.menge_einheit = e.code;
      if ("menge_wert" in roh) menge("menge_wert", einheiten.menge_einheit ?? "", { faktor: e.faktor, ziel: e.code });
    }
  } else if ("menge_wert" in roh) menge("menge_wert", "", { faktor: 1, ziel: "" });
  for (const k of Object.keys(felder)) {
    // Zusicherung wie der CHECK in der DB: kein Personen-Schluessel verlaesst diese Funktion.
    if (istPersonenSchluessel(k)) delete felder[k];
  }
  return { felder, fehlergrund: fehler[0] ?? null };
}

/** Signatur fuer Doppelzeilen: alle Zielfeld-Werte, ohne Fehler- und Hinweis-Schluessel. */
function doppelSignatur(felder: Record<string, string>): string {
  return JSON.stringify(
    Object.entries(felder)
      .filter(([k]) => !k.startsWith(FEHLER_PREFIX) && !k.startsWith(HINWEIS_PREFIX))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * PR f (Weggabelung 7): exakte Doppelzeilen derselben Datei — gleiche Werte
 * in allen Zielfeldern. Ergebnis: Index der Doppelzeile → Zeilennummer der
 * ersten Zeile. Die erste bleibt, die Doppelzeile wird „aehnlich" mit
 * Voreinstellung „ueberspringen" (wie ein starker Akteur-Treffer gegen den Bestand).
 */
export function findeDoppelzeilen(zeilen: readonly { zeilennummer: number; felder: Record<string, string> }[]): Map<number, number> {
  const erste = new Map<string, number>();
  const doppel = new Map<number, number>();
  zeilen.forEach((z, i) => {
    const sig = doppelSignatur(z.felder);
    const von = erste.get(sig);
    if (von != null) doppel.set(i, von);
    else erste.set(sig, z.zeilennummer);
  });
  return doppel;
}

/** CSV-Zelle: Semikolon, Anfuehrungszeichen und Zeilenumbrueche werden gequotet. */
function csvZelle(t: string): string {
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * Bereinigte Kopie der Importdatei (E67, DSGVO): nur Spalten mit Zielfeld —
 * keine Personen-Spalten, keine ignorierten, keine nicht zugeordneten.
 * Spaltennamen wie in der Datei, Werte als Text, UTF-8 mit BOM und
 * Semikolon (oeffnet Excel direkt). Haengt als Datei am Lauf-Beleg.
 * Zellen mit Kontaktdaten (B5) sind durch einen Platzhalter ersetzt.
 */
export function bereinigteCsv(spalten: readonly string[], zeilen: readonly string[][], z: Zuordnung): string {
  const indizes = spalten
    .map((sp, i) => ({ sp, i, ziel: z.spalten[sp] ?? "" }))
    .filter(({ ziel }) => ziel !== "" && ziel !== PERSON && ziel !== IGNORIEREN && !istPersonenSchluessel(ziel) && !!zielfeld(ziel))
    .map(({ i }) => i);
  const kopf = indizes.map((i) => csvZelle(spalten[i]!)).join(";");
  // PR f (B5): eine Zelle mit E-Mail oder Telefonnummer kommt auch in die Beleg-Kopie nicht hinein.
  const zelle = (t: string) => csvZelle(enthaeltKontaktdaten(t) ? KONTAKTDATEN_ERSATZ : t);
  const rumpf = zeilen.map((zeile) => indizes.map((i) => zelle(zeile[i] ?? "")).join(";"));
  return `\ufeff${[kopf, ...rumpf].join("\r\n")}\r\n`;
}

/**
 * E69: Vorschlag fuer den Preis-Bezug des Laufs aus den Kopfzeilen der
 * Preis-Spalten — „atro" oder „TM" im Namen schlaegt atro vor (zur
 * Bestaetigung in der Zuordnung), sonst fm. Nur fuer Spalten, die einem
 * Preisfeld zugeordnet sind.
 */
export function preisBezugVorschlag(spalten: readonly string[], zuordnung: Record<string, string>): "fm" | "atro" {
  const preisSpalten = spalten.filter((sp) => /^preis_(min|mittel|max)$/.test(zuordnung[sp] ?? ""));
  return preisSpalten.some((sp) => /atro|\btm\b|trockenmasse/i.test(sp)) ? "atro" : "fm";
}
