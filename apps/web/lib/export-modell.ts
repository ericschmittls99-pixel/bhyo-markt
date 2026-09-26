/**
 * E36 — Exportmodell (F6 PR A). Die EINZIGE Stelle, an der eine Exportspalte
 * definiert wird: Schlüssel, Kopf (mit Einheit und Vorzeichenrichtung),
 * Wertfunktion und die Pflicht-Einstufung, was im externen Modus mit ihr
 * geschieht. CSV (hier) und Druck-Route (PR B) lesen dieselbe Liste.
 *
 * Einstufung — jede Spalte muss eine tragen, der Test in
 * export-modell.test.ts lässt eine Spalte ohne Einstufung scheitern:
 *   - `keine_belegangabe`: geht in beiden Modi hinaus (Mengen, Preise, Ort …).
 *   - `belegangabe`: Quellenangabe, Datei, Link, Belegnummer. Extern nur,
 *     wenn der Beleg zur externen Verwendung freigegeben ist; sonst steht
 *     benannt „nicht zur externen Verwendung freigegeben" (E24, nie leer).
 *   - `gekuerzt`: Vergaben. Extern bleiben Zeitraum und „bhyo"/„extern
 *     vergeben", der Abnehmername wird zurückgehalten (Ergänzung Eric,
 *     26.09.2026: eine Vergabe benennt einen Vertrag zwischen Dritten).
 *
 * Eine Spalte, eine Einheit — sie steht im Kopf, nie in der Zelle, und
 * wechselt nie je Zeile. Deshalb Paare wie im Filter aus F5 (stofflich /
 * energetisch), abgeleitet über den Heizwert (E23). Der Einheitenwechsel
 * aus E20 gilt nur für die Anzeige.
 *
 * Keine leeren Zellen. Benannte Zustände (E24): „entfällt" (Spalte gilt für
 * diese Stromart nicht), „nicht erfasst" (Lücke im Bestand), „kein
 * Energieäquivalent" (Eigenschaft der Sache), „kein Beleg" (Strom ohne
 * Beleg). Auch in Zahlenspalten steht dann Text — Excel lässt Text beim
 * Summieren aus, es entsteht nie eine stille Null.
 */
import { CLUSTER_LABEL } from "./farben";
import { potenzialEuroFeedstock, potenzialEuroOutput } from "./potenzial";
import { BELEG_LABEL, istBelegTyp } from "./qualitaet";
import { STATUS_LABEL } from "./status";
import {
  type GroessenWert,
  type Strom,
  energetischeMenge,
  energetischerPreis,
  kreisAnzeige,
  landAnzeige,
  stofflicherPreis,
} from "./stroeme-modell";
import { VERIFIKATION_LABEL, type VerifikationsStatus } from "./verifizierung";
import { type VergabeDaten, vergabeLabel, verfuegbarkeitPill } from "./verfuegbarkeit";

export type ExportModus = "extern" | "intern";
export const EXPORT_MODI: readonly ExportModus[] = ["extern", "intern"];

export function exportModus(roh: string | null | undefined): ExportModus {
  // Voreinstellung extern: Wer alles sehen will, muss es bewusst wählen,
  // damit Vergessen nie zu einem Leck führt (E36).
  return roh === "intern" ? "intern" : "extern";
}

export type Einstufung = "keine_belegangabe" | "belegangabe" | "gekuerzt";
export const EINSTUFUNGEN: readonly Einstufung[] = ["keine_belegangabe", "belegangabe", "gekuerzt"];

// Benannte Zustände — Wortlaut an genau einer Stelle.
export const ENTFAELLT = "entfällt";
export const NICHT_ERFASST = "nicht erfasst";
export const KEIN_ENERGIEAEQUIVALENT = "kein Energieäquivalent";
export const KEIN_BELEG = "kein Beleg";
export const ZURUECKGEHALTEN = "nicht zur externen Verwendung freigegeben";

export interface ExportSpalte {
  key: string;
  /** Spaltenkopf mit Einheit in eckigen Klammern und Vorzeichenrichtung in Worten. */
  kopf: string;
  einstufung: Einstufung;
  /** Wert im internen Modus (voller Inhalt). */
  wert: (s: Strom) => string;
  /** Nur bei `gekuerzt`: Wert im externen Modus. */
  wertExtern?: (s: Strom) => string;
}

// --- Formatierung für deutsches Excel (E31: Komma als Dezimaltrenner) -------

/** Zahl ohne Tausenderpunkte, Komma als Dezimaltrenner; E20: ganzzahlig, sofern keine Ausnahme. */
export function csvZahl(n: number, nachkomma = 0): string {
  return n.toFixed(nachkomma).replace(".", ",").replace(/^-0$/, "0");
}

/** TT.MM.JJJJ aus ISO; null bleibt ein benannter Zustand (Aufrufer entscheidet welcher). */
export function csvDatum(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const [j, m, t] = iso.slice(0, 10).split("-");
  return `${t}.${m}.${j}`;
}

function zahlOderZustand(v: number | null | undefined, nachkomma = 0): string {
  return v == null ? NICHT_ERFASST : csvZahl(v, nachkomma);
}

/** GroessenWert (Zahl, Lücke oder benannter Zustand) in Zellentext. */
function groesse(v: GroessenWert): string {
  if (v == null) return NICHT_ERFASST;
  if (typeof v === "object") return KEIN_ENERGIEAEQUIVALENT;
  return csvZahl(v);
}

/** Nur bei Outputs; Feedstock trägt „entfällt". */
const nurOutput = (fn: (s: Strom) => string) => (s: Strom) => (s.art === "output" ? fn(s) : ENTFAELLT);
const nurFeedstock = (fn: (s: Strom) => string) => (s: Strom) => (s.art === "biomasse" ? fn(s) : ENTFAELLT);

/** Nur der Dateiname — nie Speicherschlüssel oder URL auf die Ablage (E36). */
export function dateiName(dateiKey: string | null | undefined): string | null {
  if (!dateiKey) return null;
  const letzter = dateiKey.split("/").pop() ?? dateiKey;
  // Schlüsselform aus beleg-server.ts: <uuid>-<sicherer Name>.
  return letzter.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

/** Beleg-Datei: der Beleg trägt entweder eine Datei (href auf /api/belege/<key>) oder einen Link. */
function belegDatei(s: Strom): string | null {
  const href = s.beleg?.href;
  if (!href) return null;
  const key = href.startsWith("/api/belege/") ? href.slice("/api/belege/".length) : null;
  return key ? dateiName(key) : null;
}

function belegLink(s: Strom): string | null {
  const href = s.beleg?.href;
  if (!href || href.startsWith("/api/belege/")) return null;
  return href;
}

function vergabeText(v: VergabeDaten, mitName: boolean): string {
  const zeitraum = vergabeLabel(v.vergebenVon, v.vergebenBis);
  if (v.anBhyo) return `${zeitraum} an bhyo`;
  return mitName ? `${zeitraum} an ${v.vergebenAn ?? NICHT_ERFASST}` : `${zeitraum} extern vergeben`;
}

function vergaben(s: Strom, mitName: boolean): string {
  const liste = s.vergaben ?? [];
  if (!liste.length) return "keine";
  return liste.map((v) => vergabeText(v, mitName)).join(" | ");
}

const KEINE_BELEGANGABE = "keine_belegangabe" as const;

/**
 * Spaltenreihenfolge (Eric, 26.09.2026): vom Was über das Wo zum Wieviel,
 * dann Nachweis, dann Markt.
 */
export const EXPORT_SPALTEN: readonly ExportSpalte[] = [
  // 1. Identität
  { key: "art", kopf: "Art", einstufung: KEINE_BELEGANGABE, wert: (s) => (s.art === "biomasse" ? "Feedstock" : "Output") },
  { key: "belegnummer", kopf: "Belegnummer", einstufung: "belegangabe", wert: (s) => s.beleg?.nr ?? NICHT_ERFASST },
  { key: "bezeichnung", kopf: "Bezeichnung", einstufung: KEINE_BELEGANGABE, wert: (s) => s.bezeichnung ?? NICHT_ERFASST },
  { key: "akteur", kopf: "Akteur", einstufung: KEINE_BELEGANGABE, wert: (s) => s.akteurName ?? NICHT_ERFASST },
  { key: "sektor", kopf: "Sektor", einstufung: KEINE_BELEGANGABE, wert: (s) => s.sektorLabel ?? "ohne Sektor" },
  // 2. Ort
  { key: "ort", kopf: "Ort", einstufung: KEINE_BELEGANGABE, wert: (s) => s.ort ?? NICHT_ERFASST },
  { key: "landkreis", kopf: "Landkreis", einstufung: KEINE_BELEGANGABE, wert: (s) => kreisAnzeige(s) },
  { key: "bundesland", kopf: "Bundesland", einstufung: KEINE_BELEGANGABE, wert: (s) => landAnzeige(s) },
  // 3. Einordnung
  {
    key: "cluster_gruppe",
    kopf: "Cluster bzw. Gruppe",
    einstufung: KEINE_BELEGANGABE,
    wert: (s) =>
      s.art === "biomasse"
        ? (s.cluster ? (CLUSTER_LABEL[s.cluster] ?? s.cluster) : NICHT_ERFASST)
        : (s.gruppeLabel ?? NICHT_ERFASST),
  },
  {
    key: "materialart_produkt",
    kopf: "Materialart bzw. Produkt",
    einstufung: KEINE_BELEGANGABE,
    wert: (s) => (s.art === "biomasse" ? s.materialartLabel : s.produktLabel) ?? NICHT_ERFASST,
  },
  // 4. Zeitraum
  { key: "zeitraum_von", kopf: "Zeitraum von", einstufung: KEINE_BELEGANGABE, wert: (s) => csvDatum(s.zeitraumVon) ?? NICHT_ERFASST },
  { key: "zeitraum_bis", kopf: "Zeitraum bis", einstufung: KEINE_BELEGANGABE, wert: (s) => csvDatum(s.zeitraumBis) ?? NICHT_ERFASST },
  // 5. Mengen — je Einheit eine Spalte
  { key: "menge_atro", kopf: "Menge [t atro/a]", einstufung: KEINE_BELEGANGABE, wert: nurFeedstock((s) => zahlOderZustand(s.mengeAtro)) },
  {
    key: "menge_stofflich",
    kopf: "Menge stofflich [t/a]",
    einstufung: KEINE_BELEGANGABE,
    wert: nurOutput((s) => {
      if (s.mengeWert == null || !s.mengeEinheit) return NICHT_ERFASST;
      return s.mengeEinheit === "t/a" ? csvZahl(s.mengeWert) : "keine stoffliche Menge";
    }),
  },
  { key: "menge_energetisch", kopf: "Menge energetisch [MWh/a]", einstufung: KEINE_BELEGANGABE, wert: nurOutput((s) => groesse(energetischeMenge(s))) },
  // 6. Preise — Vorzeichen nach E14 in Worten im Kopf
  { key: "preis_min", kopf: "Preis min [€/t atro] (positiv = Kosten für bhyo)", einstufung: KEINE_BELEGANGABE, wert: nurFeedstock((s) => zahlOderZustand(s.preisMin)) },
  { key: "preis_mittel", kopf: "Preis mittel [€/t atro] (positiv = Kosten für bhyo)", einstufung: KEINE_BELEGANGABE, wert: nurFeedstock((s) => zahlOderZustand(s.preisMittel)) },
  { key: "preis_max", kopf: "Preis max [€/t atro] (positiv = Kosten für bhyo)", einstufung: KEINE_BELEGANGABE, wert: nurFeedstock((s) => zahlOderZustand(s.preisMax)) },
  { key: "preis_stofflich", kopf: "Preis stofflich [€/t] (Erlös für bhyo)", einstufung: KEINE_BELEGANGABE, wert: nurOutput((s) => groesse(stofflicherPreis(s))) },
  { key: "preis_energetisch", kopf: "Preis energetisch [€/MWh] (Erlös für bhyo)", einstufung: KEINE_BELEGANGABE, wert: nurOutput((s) => groesse(energetischerPreis(s))) },
  // 7. Potenzial — E18: positiv = Erlös für bhyo, für beide Arten
  {
    key: "potenzial",
    kopf: "Potenzial [€/a] (positiv = Erlös für bhyo)",
    einstufung: KEINE_BELEGANGABE,
    wert: (s) => zahlOderZustand(s.art === "biomasse" ? potenzialEuroFeedstock(s) : potenzialEuroOutput(s)),
  },
  // 8. Nachweis
  { key: "qualitaet", kopf: "Qualität", einstufung: KEINE_BELEGANGABE, wert: (s) => s.qualitaet ?? "unbelegt" },
  {
    key: "belegtyp",
    kopf: "Belegtyp",
    einstufung: KEINE_BELEGANGABE,
    wert: (s) => (s.beleg ? (istBelegTyp(s.beleg.typ) ? BELEG_LABEL[s.beleg.typ] : s.beleg.typ) : KEIN_BELEG),
  },
  { key: "quellenangabe", kopf: "Quellenangabe", einstufung: "belegangabe", wert: (s) => (s.beleg ? (s.beleg.quellenangabe ?? NICHT_ERFASST) : KEIN_BELEG) },
  { key: "datei", kopf: "Datei", einstufung: "belegangabe", wert: (s) => (s.beleg ? (belegDatei(s) ?? "keine Datei") : KEIN_BELEG) },
  { key: "link", kopf: "Link", einstufung: "belegangabe", wert: (s) => (s.beleg ? (belegLink(s) ?? "kein Link") : KEIN_BELEG) },
  {
    key: "verifikation",
    kopf: "Verifikation",
    einstufung: KEINE_BELEGANGABE,
    wert: (s) => (s.verifikation ? VERIFIKATION_LABEL[s.verifikation.status as VerifikationsStatus] : NICHT_ERFASST),
  },
  { key: "faelligkeit", kopf: "Fälligkeit", einstufung: KEINE_BELEGANGABE, wert: (s) => csvDatum(s.verifikation?.faelligkeit) ?? "keine Frist" },
  // 9. Markt
  { key: "status", kopf: "Status", einstufung: KEINE_BELEGANGABE, wert: (s) => STATUS_LABEL[s.status] ?? s.status },
  {
    key: "verfuegbarkeit",
    kopf: "Verfügbarkeit (heute)",
    einstufung: KEINE_BELEGANGABE,
    wert: (s) => (s.verfuegbarkeit ? verfuegbarkeitPill(s.art, s.verfuegbarkeit.status).text.replace(/\.$/, "") : "ohne Zeitraum"),
  },
  { key: "reserviert", kopf: "Reserviert (bhyo)", einstufung: KEINE_BELEGANGABE, wert: (s) => (s.reserviertBhyo ? "ja" : "nein") },
  { key: "reserviert_seit", kopf: "Reserviert seit", einstufung: KEINE_BELEGANGABE, wert: (s) => csvDatum(s.reserviertSeit) ?? "nicht reserviert" },
  {
    key: "vergaben",
    kopf: "Vergaben",
    einstufung: "gekuerzt",
    wert: (s) => vergaben(s, true),
    wertExtern: (s) => vergaben(s, false),
  },
];

/** Zellenwert einer Spalte im gewählten Modus — hier greift die Einstufung, nirgends sonst. */
export function zellenWert(spalte: ExportSpalte, s: Strom, modus: ExportModus): string {
  if (modus === "intern") return spalte.wert(s);
  switch (spalte.einstufung) {
    case "keine_belegangabe":
      return spalte.wert(s);
    case "belegangabe":
      // Ohne Beleg gibt es nichts zurückzuhalten — der Zustand heißt „kein Beleg".
      if (!s.beleg) return spalte.wert(s);
      return s.beleg.externNachvollziehbar ? spalte.wert(s) : ZURUECKGEHALTEN;
    case "gekuerzt":
      return (spalte.wertExtern ?? spalte.wert)(s);
  }
}

export function exportZeile(s: Strom, modus: ExportModus): string[] {
  return EXPORT_SPALTEN.map((sp) => zellenWert(sp, s, modus));
}

// --- Metazeilen und Datei -----------------------------------------------------

export const MODUS_SATZ: Record<ExportModus, string> = {
  extern: "extern: nicht freigegebene Belegangaben und Abnehmernamen zurückgehalten",
  intern: "intern: enthält vertrauliche Angaben, nicht weitergeben",
};

export const BKG_VERMERK = "© GeoBasis-DE / BKG (2026), dl-de/by-2-0";

export interface ExportKontext {
  modus: ExportModus;
  /** Stand als Datum und Uhrzeit, bereits formatiert (Europe/Berlin). */
  stand: string;
  /** Ansicht und Sicht im Klartext, z. B. „ströme. · Feedstock". */
  ansicht: string;
  bezugsjahr: number;
  /** Aktive Filter im Klartext, je Eintrag „Label: Werte". */
  aktiveFilter: string[];
  /** Gesetzte, in dieser Ansicht aber nicht angewandte Filter (E32). */
  nichtAngewandt: string[];
}

/** Metazeilen — jede Datei sagt selbst, was sie ist. */
export function metazeilen(k: ExportKontext): string[][] {
  return [
    ["Modus", MODUS_SATZ[k.modus]],
    ["Stand", k.stand],
    ["Ansicht", k.ansicht],
    ["Bezugsjahr", String(k.bezugsjahr)],
    ["Aktive Filter", k.aktiveFilter.length ? k.aktiveFilter.join(" · ") : "keine"],
    ["Nicht angewandte Filter", k.nichtAngewandt.length ? k.nichtAngewandt.join(" · ") : "keine"],
    // Landkreis und Bundesland sind immer enthalten — der Vermerk also auch.
    ["Quellenvermerk", `Landkreis/Bundesland: ${BKG_VERMERK}`],
  ];
}

function csvFeld(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

/** Vollständige CSV: Metazeilen, Kopf, Zeilen. Semikolon, CRLF, UTF-8 mit BOM. */
export function erzeugeCsv(stroeme: Strom[], k: ExportKontext): string {
  const zeilen: string[][] = [
    ...metazeilen(k),
    [],
    EXPORT_SPALTEN.map((sp) => sp.kopf),
    ...stroeme.map((s) => exportZeile(s, k.modus)),
  ];
  return "﻿" + zeilen.map((z) => z.map(csvFeld).join(";")).join("\r\n") + "\r\n";
}

/** markt-<sicht>-<modus>-<JJJJ-MM-TT>.csv — ein Name, der sagt, was drin ist. */
export function exportDateiname(sicht: string, modus: ExportModus, stichtagIso: string): string {
  return `markt-${sicht}-${modus}-${stichtagIso.slice(0, 10)}.csv`;
}

/** Zeilenweises Einlesen für Tests und Gegenproben: Anführungszeichen und Verdopplungen zurücknehmen. */
export function parseCsv(text: string): string[][] {
  return text
    .replace(/^﻿/, "")
    .split("\r\n")
    .filter((z) => z.length)
    .map((z) =>
      z
        .split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((f) => f.replace(/^"|"$/g, "").replace(/""/g, '"')),
    );
}
