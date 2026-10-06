import { dezimalKanonisch, monatKanonisch } from "@/lib/eingabe-format";
import { istPersonenSchluessel } from "@/lib/import-modell";
import type { StromArt } from "@/lib/stroeme-modell";

/**
 * AP2.7 PR b (E67): Spalten- und Werte-Zuordnung — reine Regeln. Zielfelder
 * sind die FormData-Schluessel des Erfassungsformulars (strom-schreibweg.ts,
 * akteur-eingabe.ts mit Praefix akteur_), damit der Probelauf jede Zeile
 * durch dieselben Bausteine schickt wie das Formular. Personen-Spalten
 * werden erkannt oder markiert und nie in `felder` uebernommen.
 */

export type ZielTyp = "text" | "zahl" | "monat" | "einheit" | "code";
export type WerteListe = "materialart" | "produkt" | "sektor" | "beleg_typ" | "menge_einheit";

export interface Zielfeld {
  key: string;
  label: string;
  gruppe: "akteur" | "strom" | "beleg";
  arten: readonly StromArt[];
  /** Pflicht im Formular: ohne Zuordnung scheitert jede Zeile — die Zuordnung weist das vorher ab. */
  pflicht: boolean;
  typ: ZielTyp;
  werte?: WerteListe;
  synonyme: readonly string[];
}

export const PERSON = "person";
export const IGNORIEREN = "ignorieren";

const BEIDE: readonly StromArt[] = ["biomasse", "output"];

export const ZIELFELDER: readonly Zielfeld[] = [
  // Akteur (E66): Name Pflicht; PLZ, Ort und Pin braucht ein NEUER Akteur — ohne Treffer beim Aufloesen landet die Zeile in der Nacharbeit.
  { key: "akteur_name", label: "Akteur · Name", gruppe: "akteur", arten: BEIDE, pflicht: true, typ: "text", synonyme: ["akteur", "name", "betrieb", "betriebsname", "firma", "unternehmen", "anbieter", "lieferant", "abnehmer", "kunde", "erzeuger"] },
  { key: "akteur_sektor", label: "Akteur · Sektor", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "code", werte: "sektor", synonyme: ["sektor", "branche"] },
  { key: "akteur_sitz_strasse", label: "Akteur · Sitz Straße", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["strasse", "str", "sitz strasse", "adresse"] },
  { key: "akteur_sitz_hausnummer", label: "Akteur · Sitz Hausnummer", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["hausnummer", "hausnr", "nr", "sitz hausnummer"] },
  { key: "akteur_sitz_plz", label: "Akteur · Sitz PLZ", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["plz", "postleitzahl", "sitz plz"] },
  { key: "akteur_sitz_ort", label: "Akteur · Sitz Ort", gruppe: "akteur", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["ort", "stadt", "gemeinde", "sitz ort"] },
  // Strom — Feedstock
  { key: "materialart_code", label: "Materialart", gruppe: "strom", arten: ["biomasse"], pflicht: true, typ: "code", werte: "materialart", synonyme: ["materialart", "material", "stoff", "substrat", "biomasse", "einsatzstoff", "reststoff"] },
  { key: "menge_roh_fm", label: "Menge (t FM/a)", gruppe: "strom", arten: ["biomasse"], pflicht: true, typ: "zahl", synonyme: ["menge", "menge fm", "rohmenge", "jahresmenge", "tonnen", "menge t a", "menge t fm a"] },
  { key: "menge_einheit_fm", label: "Einheit der Menge (t/kg je Jahr/Monat)", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "einheit", synonyme: ["einheit", "mengeneinheit"] },
  { key: "ts_anteil_pct", label: "TS-Anteil %", gruppe: "strom", arten: ["biomasse"], pflicht: true, typ: "zahl", synonyme: ["ts", "ts anteil", "ts anteil %", "ts %", "trockensubstanz", "trockensubstanz %", "tm %", "ts gehalt"] },
  { key: "aschegehalt_pct", label: "Aschegehalt %", gruppe: "strom", arten: ["biomasse"], pflicht: true, typ: "zahl", synonyme: ["asche", "aschegehalt", "aschegehalt %", "asche %"] },
  { key: "preis_min", label: "Preis min €/t", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["preis min", "preis von", "min preis"] },
  { key: "preis_mittel", label: "Preis mittel €/t", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["preis", "preis mittel", "mittelpreis", "preis t"] },
  { key: "preis_max", label: "Preis max €/t", gruppe: "strom", arten: ["biomasse"], pflicht: false, typ: "zahl", synonyme: ["preis max", "preis bis", "max preis"] },
  // Strom — Bedarf
  { key: "produkt_code", label: "Produkt", gruppe: "strom", arten: ["output"], pflicht: true, typ: "code", werte: "produkt", synonyme: ["produkt", "output", "bedarf", "output produkt"] },
  { key: "menge_wert", label: "Menge", gruppe: "strom", arten: ["output"], pflicht: true, typ: "zahl", synonyme: ["menge", "bedarf menge", "jahresmenge", "jahresbedarf"] },
  { key: "menge_einheit", label: "Einheit der Menge (t/a, MWh/a, Nm³/a)", gruppe: "strom", arten: ["output"], pflicht: true, typ: "code", werte: "menge_einheit", synonyme: ["einheit", "mengeneinheit"] },
  { key: "preis", label: "Preis", gruppe: "strom", arten: ["output"], pflicht: false, typ: "zahl", synonyme: ["preis"] },
  // Strom — beide
  { key: "zeitraum_von", label: "Zeitraum von (MM/JJJJ)", gruppe: "strom", arten: BEIDE, pflicht: true, typ: "monat", synonyme: ["zeitraum von", "von", "ab", "beginn", "start", "verfuegbar ab", "von monat"] },
  { key: "zeitraum_bis", label: "Zeitraum bis (MM/JJJJ)", gruppe: "strom", arten: BEIDE, pflicht: true, typ: "monat", synonyme: ["zeitraum bis", "bis", "ende", "verfuegbar bis", "bis monat"] },
  { key: "bezeichnung", label: "Bezeichnung", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["bezeichnung", "beschreibung", "titel", "bemerkung"] },
  { key: "strasse", label: "Standort · Straße", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort strasse", "standort str"] },
  { key: "hausnummer", label: "Standort · Hausnummer", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort hausnummer", "standort nr"] },
  { key: "plz", label: "Standort · PLZ", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort plz"] },
  { key: "ort", label: "Standort · Ort", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "text", synonyme: ["standort ort", "standort"] },
  { key: "lat", label: "Standort · Breite", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "zahl", synonyme: ["lat", "latitude", "breite", "breitengrad"] },
  { key: "lng", label: "Standort · Länge", gruppe: "strom", arten: BEIDE, pflicht: false, typ: "zahl", synonyme: ["lng", "lon", "longitude", "laenge", "laengengrad"] },
  // Beleg: der Typ je Lauf ist Pflicht; eine Spalte darf ihn je Zeile ueberschreiben.
  { key: "beleg_typ", label: "Belegtyp (überschreibt den des Laufs)", gruppe: "beleg", arten: BEIDE, pflicht: false, typ: "code", werte: "beleg_typ", synonyme: ["belegtyp", "beleg typ", "beleg", "quelle", "quellenart", "nachweis"] },
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

/** Spaltenname → Zielfeld-Key, PERSON, oder "" (keine Idee — der Mensch entscheidet). */
export function vorschlagZuordnung(art: StromArt, spalten: readonly string[]): Record<string, string> {
  const vergeben = new Set<string>();
  const zuordnung: Record<string, string> = {};
  for (const sp of spalten) {
    if (istPersonenSchluessel(sp)) {
      zuordnung[sp] = PERSON;
      continue;
    }
    const n = normName(sp.replace(/\s*\(\d+\)$/, ""));
    const treffer = zielfelderFuer(art).find((z) => !vergeben.has(z.key) && z.synonyme.some((syn) => normName(syn) === n));
    zuordnung[sp] = treffer?.key ?? "";
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

/**
 * E67: Mengen nur t FM/a. Eine Einheitenspalte darf t oder kg und pro Jahr
 * oder pro Monat enthalten — ohne Annahme umrechenbar. Alles andere,
 * insbesondere TM/atro, ist ein Zeilenfehler. Leer heisst t/a.
 */
export function einheitFaktor(text: string): { faktor: number } | { fehler: string } {
  const t = text.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");
  if (t === "") return { faktor: 1 };
  if (/(tm|atro|trocken|ts\b|ots)/.test(t)) return { fehler: `Einheit „${text}" bezieht sich auf Trockenmasse — erwartet wird Frischmasse (t FM/a).` };
  const m = /^(t|to|tonne|tonnen|kg|kilogramm)(fm|frischmasse)?(?:\/|pro|je|p)?(a|jahr|j|pa|monat|mon|m|mtl)?$/.exec(t);
  if (!m) return { fehler: `Einheit „${text}" ist nicht umrechenbar — erlaubt sind t oder kg je Jahr oder Monat.` };
  const masse = m[1]!.startsWith("k") ? 0.001 : 1;
  const zeit = m[3] && /^(monat|mon|m|mtl)$/.test(m[3]) ? 12 : 1;
  return { faktor: masse * zeit };
}

/** Zahl in Speicherform (ohne Rundung) → Text mit Komma, wie getippt. */
export function zahlText(n: number): string {
  return String(n).replace(".", ",");
}

/** Monat aus Spaltentext: MM/JJJJ & Co. (monatKanonisch) oder JJJJ-MM-TT aus einer Datumszelle → JJJJ-MM; sonst Rohtext (das Formular meldet ihn). */
export function monatAusText(text: string): string {
  const t = text.trim();
  const datum = /^(\d{4})-(\d{2})-\d{2}$/.exec(t);
  if (datum) return `${datum[1]}-${datum[2]}`;
  return monatKanonisch(t) || t;
}

export interface ZeileErgebnis {
  /** Nur zugeordnete Zielfelder, nie Personen-Schluessel. */
  felder: Record<string, string>;
  /** Erster Fehler, der die Zeile scheitern laesst, sonst null. */
  fehlergrund: string | null;
}

/**
 * Eine Datenzeile → Zielfelder. Codes werden ueber die Werte-Zuordnung
 * aufgeloest (nicht zugeordneter Wert = Zeilenfehler), die Menge ueber die
 * Einheit in t FM/a gebracht, Monate kanonisiert. Zahlen bleiben sonst Text —
 * E31 prueft sie im Formularweg des Probelaufs.
 */
export function zeileZuFelder(spalten: readonly string[], zeile: readonly string[], z: Zuordnung): ZeileErgebnis {
  const felder: Record<string, string> = {};
  const fehler: string[] = [];
  let einheit = "";
  for (let i = 0; i < spalten.length; i++) {
    const sp = spalten[i]!;
    const ziel = z.spalten[sp] ?? "";
    if (ziel === "" || ziel === PERSON || ziel === IGNORIEREN) continue;
    const def = zielfeld(ziel);
    if (!def || istPersonenSchluessel(ziel)) continue;
    const wert = (zeile[i] ?? "").trim();
    switch (def.typ) {
      case "einheit":
        einheit = wert;
        break;
      case "code": {
        if (wert === "") {
          felder[ziel] = "";
          break;
        }
        const code = z.werte[ziel]?.[wert] ?? "";
        if (code === "") fehler.push(`${def.label}: Wert „${wert}" ist keinem Code zugeordnet.`);
        felder[ziel] = code;
        break;
      }
      case "monat":
        felder[ziel] = monatAusText(wert);
        break;
      default:
        felder[ziel] = wert;
    }
  }
  if ("menge_roh_fm" in felder) {
    const e = einheitFaktor(einheit);
    if ("fehler" in e) fehler.push(e.fehler);
    else if (e.faktor !== 1 && felder.menge_roh_fm) {
      const n = Number(dezimalKanonisch(felder.menge_roh_fm));
      if (Number.isFinite(n)) felder.menge_roh_fm = zahlText(n * e.faktor);
    }
  }
  for (const k of Object.keys(felder)) {
    // Zusicherung wie der CHECK in der DB: kein Personen-Schluessel verlaesst diese Funktion.
    if (istPersonenSchluessel(k)) delete felder[k];
  }
  return { felder, fehlergrund: fehler[0] ?? null };
}
