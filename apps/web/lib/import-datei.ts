import * as XLSX from "xlsx";

/**
 * AP2.7 PR b (E67): Upload und Parsen der Importdatei — reine Funktionen,
 * ohne DB und ohne Request. SheetJS liest CSV und Excel gleich; die
 * Zellwerte kommen als Text heraus, so wie ein Mensch sie ins Formular
 * tippen wuerde (Komma als Dezimaltrenner), damit danach dieselben Regeln
 * gelten wie beim Formular (lib/eingabe-format.ts, E31: mehrdeutig wird
 * abgewiesen, nie geraten).
 */

/**
 * Grenze 5.000 Zeilen / 5 MB (E67). Begruendung aus der Messung vom
 * 06.10.2026: SheetJS parst in workerd 5.000 Zeilen in ≈0,7 s, 20.000 in
 * ≈2 s bei ~104 MB Heap — 5.000 lassen Luft unter dem 128-MB-Limit des
 * Workers. Ausfuehren laeuft stapelweise mit ≈33 ms je Zeile, 5.000 Zeilen
 * sind ≈3 Minuten im Browser-gesteuerten Ablauf. 5 MB decken jede
 * realistische Erhebungsliste und halten den Roh-Upload in R2 klein.
 */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ZEILEN = 5000;

/** Zulaessige Endungen — alles, was SheetJS sicher als Tabelle liest. */
export const IMPORT_ENDUNGEN = [".xlsx", ".xlsm", ".xls", ".csv"] as const;

export interface BlattInfo {
  name: string;
  /** Nicht-leere Zeilen im Blatt. */
  zeilen: number;
  /** Kopfzeile automatisch erkannt und mindestens eine Datenzeile darunter. */
  tabelle: boolean;
  /** Erkannte Kopfzeile (1-basiert), null ohne erkennbare Tabelle. */
  kopfzeile: number | null;
}

export interface ParseOptionen {
  /** Blattname; fehlt er, das erste Blatt mit erkennbarer Tabelle, sonst das erste Blatt. */
  blatt?: string;
  /** Kopfzeile 1-basiert (wie in Excel); fehlt sie, wird sie erkannt. */
  kopfzeile?: number;
}

export interface ImportTabelle {
  /** Kopfzeile, getrimmt; doppelte Namen werden nummeriert („PLZ", „PLZ (2)"). */
  spalten: string[];
  /** Datenzeilen als Text je Spalte, leere Zeilen entfernt; Laenge = spalten.length. */
  zeilen: string[][];
  /** Excel-Zeilennummer je Datenzeile (1-basiert) — Nacharbeit und Datei passen zusammen. */
  zeilennummern: number[];
  blatt: string;
  kopfzeile: number;
  blaetter: BlattInfo[];
  /** Uebersprungene Zeilen: ueber der Kopfzeile, leer, Summenzeile, Fusszeile (PR e). */
  uebersprungen: { oben: number; leer: number; summe: number; fuss: number };
  /** Rohe Vorschau ab der Kopfzeile (bis zu 4 Zeilen) fuer die Kopfzeilen-Wahl. */
  vorschau: string[][];
}

export class ImportDateiFehler extends Error {}

export function dateiEndung(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i).toLowerCase();
}

export function dateiErlaubt(name: string): boolean {
  return (IMPORT_ENDUNGEN as readonly string[]).includes(dateiEndung(name));
}

/** SHA-256 als Hex — der Datei-Hash des Laufs (import_lauf.datei_hash, Warnung bei Wiederholung). */
export async function sha256Hex(daten: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", daten);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Zellwert → Text wie getippt. Zahlen bekommen das Komma als Dezimaltrenner
 * und keine Tausenderpunkte (eine Excel-Zahl ist nie mehrdeutig, der Text
 * darf es auch nicht werden). Datumszellen werden JJJJ-MM-TT; was danach
 * ein Monat sein soll, bringt die Zuordnung in die Form MM/JJJJ.
 */
export function zellText(wert: unknown): string {
  if (wert == null) return "";
  if (typeof wert === "number") return Number.isFinite(wert) ? String(wert).replace(".", ",") : "";
  if (typeof wert === "boolean") return wert ? "ja" : "nein";
  if (wert instanceof Date) return Number.isNaN(wert.getTime()) ? "" : wert.toISOString().slice(0, 10);
  return String(wert).trim();
}

/**
 * CSV als Text: gueltiges UTF-8 (mit oder ohne BOM) bleibt UTF-8, sonst
 * Windows-1252 — die Kodierung, in der Excel „CSV (Trennzeichen-getrennt)"
 * schreibt. Deterministische Regel statt Raten: ungueltiges UTF-8 ist
 * eindeutig kein UTF-8. Ohne diesen Schritt laese SheetJS die Bytes als
 * Latin-1, und aus „Straße" wuerden zwei Fremdzeichen.
 */
function csvText(daten: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(daten);
  } catch {
    return new TextDecoder("windows-1252").decode(daten);
  }
}

/** Kopfzeile: getrimmt, leer → „Spalte n", doppelt → „Name (2)". */
export function spaltenNamen(kopf: unknown[]): string[] {
  const gesehen = new Map<string, number>();
  return kopf.map((k, i) => {
    const basis = zellText(k) || `Spalte ${i + 1}`;
    const n = (gesehen.get(basis) ?? 0) + 1;
    gesehen.set(basis, n);
    return n === 1 ? basis : `${basis} (${n})`;
  });
}

type Zeile = unknown[];

function nichtLeer(z: Zeile): number {
  return z.filter((c) => zellText(c) !== "").length;
}

function istText(c: unknown): boolean {
  return typeof c === "string" && c.trim() !== "" && !/^[-+]?\d+([.,]\d+)?$/.test(c.trim());
}

/**
 * Kopfzeile erkennen (PR e, Eric 07.10.2026): die erste Zeile mit mindestens
 * zwei nicht-leeren Zellen, davon ueberwiegend Text, auf die innerhalb der
 * naechsten drei Zeilen ein Datenblock folgt (eine Zeile mit mindestens zwei
 * Zellen). Titelzeilen mit einer Zelle fallen so heraus. Null, wenn nichts passt.
 */
export function erkenneKopfzeile(zeilen: readonly Zeile[]): number | null {
  let kandidat: number | null = null;
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i]!;
    const n = nichtLeer(z);
    if (n < 2) continue;
    const text = z.filter(istText).length;
    if (text / n < 0.6) continue;
    const folgt = zeilen.slice(i + 1, i + 4).some((f) => nichtLeer(f) >= 2);
    if (folgt) return i + 1;
    // Kopfzeile ohne Datenblock: bleibt Kandidat, damit die Meldung „keine Datenzeile" statt „keine Kopfzeile" lautet.
    kandidat ??= i + 1;
  }
  return kandidat;
}

function leseBuch(daten: ArrayBuffer, dateiname: string): XLSX.WorkBook {
  if (!dateiErlaubt(dateiname)) {
    throw new ImportDateiFehler(`Dateityp nicht unterstützt: erlaubt sind ${IMPORT_ENDUNGEN.join(", ")}.`);
  }
  if (daten.byteLength > IMPORT_MAX_BYTES) {
    throw new ImportDateiFehler(`Datei ist größer als ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`);
  }
  try {
    // PR f: cellDates aus — SheetJS baut Date-Objekte in der Zeitzone des
    // Prozesses, toISOString() verschiebt sie dann um einen Tag (Berlin vs.
    // UTC-Worker, Befund CI 07.10.2026). Datumszellen werden stattdessen aus
    // der Excel-Seriennummer gerechnet (rohZeilen), ohne Zeitzone.
    return dateiEndung(dateiname) === ".csv"
      ? XLSX.read(csvText(daten), { type: "string", cellDates: false, cellNF: true, raw: true, dense: true })
      : XLSX.read(new Uint8Array(daten), { type: "array", cellDates: false, cellNF: true, raw: true, dense: true });
  } catch {
    throw new ImportDateiFehler("Datei konnte nicht gelesen werden — ist es eine CSV- oder Excel-Datei?");
  }
}

type DenseZelle = { t?: string; v?: unknown; z?: string; f?: string } | undefined;

/** Excel-Seriennummer mit Datumsformat → JJJJ-MM-TT, deterministisch (keine Zeitzone, kein Date-Objekt). */
export function datumAusSeriennummer(wert: number, format: string | undefined): string | null {
  if (!format || !XLSX.SSF.is_date(format)) return null;
  const d = XLSX.SSF.parse_date_code(wert);
  if (!d) return null;
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

/** Rohzeilen eines Blatts mit Leerzeilen (Index = Excel-Zeile − 1), Datumszellen als JJJJ-MM-TT, und die Zeilen mit Formeln. */
function rohZeilen(blatt: XLSX.WorkSheet): { zeilen: Zeile[]; formelZeilen: Set<number> } {
  const zeilen = XLSX.utils.sheet_to_json<Zeile>(blatt, { header: 1, raw: true, defval: null, blankrows: true });
  const formelZeilen = new Set<number>();
  const dense = (blatt as unknown as { "!data"?: DenseZelle[][] })["!data"];
  if (dense) {
    dense.forEach((r, i) => {
      if (r?.some((c) => c?.f)) formelZeilen.add(i + 1);
      r?.forEach((c, j) => {
        if (c?.t === "n" && typeof c.v === "number" && zeilen[i]) {
          const datum = datumAusSeriennummer(c.v, c.z);
          if (datum) zeilen[i]![j] = datum;
        }
      });
    });
  }
  return { zeilen, formelZeilen };
}

/** Uebersicht aller Blaetter: Zeilen, erkannte Kopfzeile, Tabelle ja/nein. */
export function blaetterUebersicht(daten: ArrayBuffer, dateiname: string): BlattInfo[] {
  const buch = leseBuch(daten, dateiname);
  return buch.SheetNames.map((name) => {
    const { zeilen } = rohZeilen(buch.Sheets[name]!);
    const kopf = erkenneKopfzeile(zeilen);
    const daten = kopf ? zeilen.slice(kopf).filter((z) => nichtLeer(z) >= 2).length : 0;
    return { name, zeilen: zeilen.filter((z) => nichtLeer(z) > 0).length, tabelle: kopf != null && daten > 0, kopfzeile: kopf };
  });
}

/** Summenzeile: Formel in der Zeile oder erste Textzelle „Summe"/„Gesamt"/„Total". */
function istSummenzeile(z: Zeile, excelZeile: number, formelZeilen: Set<number>): boolean {
  if (formelZeilen.has(excelZeile)) return true;
  const erster = z.map(zellText).find((t) => t !== "");
  return erster != null && /^(summe|gesamt|total)\b/i.test(erster);
}

/**
 * Liest ein Blatt (PR e: waehlbar, Kopfzeile erkannt oder vorgegeben).
 * Zeilen ueber der Kopfzeile werden ignoriert; darunter werden Leerzeilen,
 * eine Summenzeile (Formel oder „Summe"/„Gesamt") und Fusszeilen (hoechstens
 * eine Zelle bei mindestens drei Spalten) uebersprungen und gezaehlt. Mehr
 * als IMPORT_MAX_ZEILEN: Fehler — bewusst vor jedem Speichern.
 */
export function parseImportDatei(daten: ArrayBuffer, dateiname: string, opt: ParseOptionen = {}): ImportTabelle {
  const buch = leseBuch(daten, dateiname);
  const blaetter = blaetterUebersicht(daten, dateiname);
  if (blaetter.length === 0) throw new ImportDateiFehler("Die Datei enthält kein Tabellenblatt.");
  const blattName = opt.blatt ?? (blaetter.find((b) => b.tabelle) ?? blaetter[0]!).name;
  const blattInfo = blaetter.find((b) => b.name === blattName);
  const blatt = buch.Sheets[blattName];
  if (!blatt || !blattInfo) throw new ImportDateiFehler(`Blatt „${blattName}" gibt es in der Datei nicht.`);
  const { zeilen: roh, formelZeilen } = rohZeilen(blatt);
  const kopfzeile = opt.kopfzeile ?? blattInfo.kopfzeile;
  if (kopfzeile == null) throw new ImportDateiFehler(`Im Blatt „${blattName}" ist keine Kopfzeile erkennbar — Kopfzeile von Hand wählen.`);
  const kopf = roh[kopfzeile - 1];
  if (!kopf || kopf.every((z) => zellText(z) === "")) throw new ImportDateiFehler(`Zeile ${kopfzeile} ist leer — sie kann keine Kopfzeile sein.`);
  const spalten = spaltenNamen(kopf);
  const uebersprungen = { oben: kopfzeile - 1, leer: 0, summe: 0, fuss: 0 };
  const zeilen: string[][] = [];
  const zeilennummern: number[] = [];
  for (let i = kopfzeile; i < roh.length; i++) {
    const z = roh[i]!;
    const n = nichtLeer(z);
    if (n === 0) {
      uebersprungen.leer += 1;
      continue;
    }
    if (istSummenzeile(z, i + 1, formelZeilen)) {
      uebersprungen.summe += 1;
      continue;
    }
    if (n <= 1 && spalten.length >= 3) {
      uebersprungen.fuss += 1;
      continue;
    }
    zeilen.push(spalten.map((_, c) => zellText(z[c])));
    zeilennummern.push(i + 1);
  }
  if (zeilen.length === 0) throw new ImportDateiFehler("Die Datei enthält keine Datenzeile unter der Kopfzeile.");
  if (zeilen.length > IMPORT_MAX_ZEILEN) {
    throw new ImportDateiFehler(`Die Datei hat ${zeilen.length} Zeilen; erlaubt sind höchstens ${IMPORT_MAX_ZEILEN} je Lauf.`);
  }
  const vorschau = roh.slice(kopfzeile - 1, kopfzeile + 3).map((z) => (z ?? []).map(zellText));
  return { spalten, zeilen, zeilennummern, blatt: blattName, kopfzeile, blaetter, uebersprungen, vorschau };
}
