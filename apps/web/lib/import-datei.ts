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

export interface ImportTabelle {
  /** Kopfzeile, getrimmt; doppelte Namen werden nummeriert („PLZ", „PLZ (2)"). */
  spalten: string[];
  /** Datenzeilen als Text je Spalte, leere Zeilen entfernt; Laenge = spalten.length. */
  zeilen: string[][];
}

/** Fachlicher Fehler an der Datei — wird dem Nutzer genannt, kein Lauf entsteht. */
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

/**
 * Liest das erste Blatt. Ohne Kopfzeile oder ohne Datenzeile: Fehler. Mehr
 * als IMPORT_MAX_ZEILEN: Fehler — bewusst vor jedem Speichern, damit kein
 * halber Lauf entsteht.
 */
export function parseImportDatei(daten: ArrayBuffer, dateiname: string): ImportTabelle {
  if (!dateiErlaubt(dateiname)) {
    throw new ImportDateiFehler(`Dateityp nicht unterstützt: erlaubt sind ${IMPORT_ENDUNGEN.join(", ")}.`);
  }
  if (daten.byteLength > IMPORT_MAX_BYTES) {
    throw new ImportDateiFehler(`Datei ist größer als ${IMPORT_MAX_BYTES / 1024 / 1024} MB.`);
  }
  let buch: XLSX.WorkBook;
  try {
    buch =
      dateiEndung(dateiname) === ".csv"
        ? XLSX.read(csvText(daten), { type: "string", cellDates: true, raw: true, dense: true })
        : XLSX.read(new Uint8Array(daten), { type: "array", cellDates: true, raw: true, dense: true });
  } catch {
    throw new ImportDateiFehler("Datei konnte nicht gelesen werden — ist es eine CSV- oder Excel-Datei?");
  }
  const blattName = buch.SheetNames[0];
  const blatt = blattName ? buch.Sheets[blattName] : undefined;
  if (!blatt) throw new ImportDateiFehler("Die Datei enthält kein Tabellenblatt.");
  const roh = XLSX.utils.sheet_to_json<unknown[]>(blatt, { header: 1, raw: true, defval: null, blankrows: false });
  const [kopf, ...rest] = roh;
  if (!kopf || kopf.every((z) => zellText(z) === "")) throw new ImportDateiFehler("Die erste Zeile muss die Spaltennamen enthalten.");
  const spalten = spaltenNamen(kopf);
  const zeilen = rest
    .map((z) => spalten.map((_, i) => zellText(z[i])))
    .filter((z) => z.some((t) => t !== ""));
  if (zeilen.length === 0) throw new ImportDateiFehler("Die Datei enthält keine Datenzeile unter der Kopfzeile.");
  if (zeilen.length > IMPORT_MAX_ZEILEN) {
    throw new ImportDateiFehler(`Die Datei hat ${zeilen.length} Zeilen; erlaubt sind höchstens ${IMPORT_MAX_ZEILEN} je Lauf.`);
  }
  return { spalten, zeilen };
}
