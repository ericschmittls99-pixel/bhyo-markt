/**
 * AP2.7 PR b (E67): Upload und Parsen — CSV und Excel liefern dieselbe
 * Tabelle, Zahlen kommen als Text mit Komma heraus (E31-konform), Grenzen
 * greifen vor jedem Speichern, der Hash ist deterministisch. Fixtures:
 * docs/beispiele/import-biomasse.{csv,xlsx} (gleicher Inhalt, Personen-
 * Spalten absichtlich enthalten — der Import darf sie nie uebernehmen).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ZEILEN,
  datumAusSeriennummer,
  ImportDateiFehler,
  blaetterUebersicht,
  dateiErlaubt,
  erkenneKopfzeile,
  parseImportDatei,
  sha256Hex,
  spaltenNamen,
  zellText,
} from "./import-datei";

const BEISPIELE = join(__dirname, "..", "..", "..", "docs", "beispiele");
function fixture(name: string): ArrayBuffer {
  const b = readFileSync(join(BEISPIELE, name));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
function xlsxAus(zeilen: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(zeilen), "Blatt1");
  const u8 = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return u8;
}
function csvAus(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

const KOPF = ["Betrieb", "Sektor", "Straße", "Hausnummer", "PLZ", "Ort", "Ansprechpartner", "E-Mail", "Materialart", "Menge", "Einheit", "TS-Anteil %", "Zeitraum von", "Zeitraum bis"];

describe("parseImportDatei — CSV und Excel", () => {
  it("liest die CSV-Fixture: Kopfzeile, drei Datenzeilen, Werte als Text", () => {
    const t = parseImportDatei(fixture("import-biomasse.csv"), "import-biomasse.csv");
    expect(t.spalten).toEqual(KOPF);
    expect(t.zeilen).toHaveLength(3);
    expect(t.zeilen[0]).toEqual(["Hof Mustermann", "Landwirtschaft", "Dorfstraße", "3", "67346", "Speyer", "Max Mustermann", "max@example.invalid", "Rindergülle", "1.234,5", "t/a", "8,5", "01/2026", "12/2026"]);
    expect(t.zeilen[1]![1]).toBe("");
  });

  it("liest die Excel-Fixture mit denselben Spalten und Zeilen; Zahlzellen werden Text mit Komma", () => {
    const csv = parseImportDatei(fixture("import-biomasse.csv"), "import-biomasse.csv");
    const xlsx = parseImportDatei(fixture("import-biomasse.xlsx"), "import-biomasse.xlsx");
    expect(xlsx.spalten).toEqual(csv.spalten);
    expect(xlsx.zeilen).toHaveLength(3);
    // Zahlzellen (Menge, TS-Anteil) kommen aus Excel als Zahl: 1234.5 → "1234,5" (kein Tausenderpunkt, nie mehrdeutig).
    expect(xlsx.zeilen[0]![9]).toBe("1234,5");
    expect(xlsx.zeilen[0]![11]).toBe("8,5");
    expect(xlsx.zeilen[1]![9]).toBe("500");
    // Alles andere ist in beiden Dateien gleich.
    const ohneZahlen = (z: string[]) => z.filter((_, i) => i !== 9 && i !== 11);
    expect(xlsx.zeilen.map(ohneZahlen)).toEqual(csv.zeilen.map(ohneZahlen));
  });

  it("entfernt Leerzeilen und füllt kurze Zeilen auf Spaltenlänge auf", () => {
    const t = parseImportDatei(csvAus("A;B;C\n1;2;3\n\n;;\n4;5\n"), "x.csv");
    expect(t.zeilen).toEqual([["1", "2", "3"], ["4", "5", ""]]);
  });

  it("liest eine Windows-1252-CSV (Excel-Export „Trennzeichen-getrennt“) mit Umlauten richtig", () => {
    // „Straße;Rindergülle" in cp1252: ß = 0xDF, ü = 0xFC — als UTF-8 ungueltig, also eindeutig kein UTF-8.
    const bytes = new Uint8Array([...new TextEncoder().encode("Stra"), 0xdf, ...new TextEncoder().encode("e;Material\nA;Rinderg"), 0xfc, ...new TextEncoder().encode("lle")]);
    const t = parseImportDatei(bytes.buffer as ArrayBuffer, "excel.csv");
    expect(t.spalten).toEqual(["Straße", "Material"]);
    expect(t.zeilen[0]).toEqual(["A", "Rindergülle"]);
  });

  it("liest eine UTF-8-CSV mit BOM ohne Fremdzeichen im ersten Spaltennamen", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Betrieb;Ort\nHof;Speyer")]);
    expect(parseImportDatei(bytes.buffer as ArrayBuffer, "bom.csv").spalten).toEqual(["Betrieb", "Ort"]);
  });

  it("nummeriert doppelte und leere Spaltennamen", () => {
    expect(spaltenNamen(["PLZ", " PLZ ", "", "Ort", "PLZ"])).toEqual(["PLZ", "PLZ (2)", "Spalte 3", "Ort", "PLZ (3)"]);
  });

  it("Datumszellen werden JJJJ-MM-TT, Wahrheitswerte ja/nein, leer bleibt leer", () => {
    expect(zellText(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01-15");
    expect(zellText(true)).toBe("ja");
    expect(zellText(null)).toBe("");
    expect(zellText(12.345)).toBe("12,345");
    expect(zellText("  Text ")).toBe("Text");
  });
});

describe("parseImportDatei — Grenzen und Fehler (vor jedem Speichern)", () => {
  it("weist unbekannte Dateitypen ab", () => {
    expect(dateiErlaubt("liste.xlsx")).toBe(true);
    expect(dateiErlaubt("liste.CSV")).toBe(true);
    expect(dateiErlaubt("liste.pdf")).toBe(false);
    expect(() => parseImportDatei(csvAus("a;b\n1;2"), "liste.pdf")).toThrow(ImportDateiFehler);
  });

  it("weist eine Datei über 5 MB ab", () => {
    const gross = new ArrayBuffer(IMPORT_MAX_BYTES + 1);
    expect(() => parseImportDatei(gross, "gross.csv")).toThrow(/größer als 5 MB/);
  });

  it("weist eine Datei ohne Kopfzeile oder ohne Datenzeile ab", () => {
    expect(() => parseImportDatei(csvAus(""), "leer.csv")).toThrow(ImportDateiFehler);
    expect(() => parseImportDatei(csvAus("A;B;C\n"), "nurkopf.csv")).toThrow(/keine Datenzeile/);
    // Eine leere erste Zeile faellt als Leerzeile weg; die naechste wird Kopf, danach fehlt die Datenzeile.
    expect(() => parseImportDatei(xlsxAus([[null, null], ["1", "2"]]), "ohnekopf.xlsx")).toThrow(ImportDateiFehler);
  });

  it(`weist mehr als ${IMPORT_MAX_ZEILEN} Zeilen ab und nennt die Zahl`, () => {
    const zeilen = Array.from({ length: IMPORT_MAX_ZEILEN + 1 }, (_, i) => `${i};x`).join("\n");
    expect(() => parseImportDatei(csvAus(`Nr;Wert\n${zeilen}`), "viele.csv")).toThrow(`${IMPORT_MAX_ZEILEN + 1} Zeilen`);
    const genau = Array.from({ length: IMPORT_MAX_ZEILEN }, (_, i) => `${i};x`).join("\n");
    expect(parseImportDatei(csvAus(`Nr;Wert\n${genau}`), "genau.csv").zeilen).toHaveLength(IMPORT_MAX_ZEILEN);
  });

  it("Kaputte Datei → genannter Fehler, keine rohe Ausnahme", () => {
    expect(() => parseImportDatei(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).buffer as ArrayBuffer, "kaputt.xlsx")).toThrow(ImportDateiFehler);
  });
});

describe("sha256Hex", () => {
  it("ist deterministisch und entspricht shasum -a 256 der Fixture", async () => {
    const h = await sha256Hex(fixture("import-biomasse.csv"));
    expect(h).toBe("9e03cf9b31e8720138b4b743151f7d967e1a0181c205b3e2cc996c734a71e8fa");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(csvAus("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("parseImportDatei — Blattwahl, Kopfzeile, Datenblock (PR e, Testdatei AP2.7)", () => {
  const datei = () => fixture("import-testdatei-ap27.xlsx");

  it("Uebersicht: vier Blaetter, Legende ohne erkennbare Tabelle, Erhebung mit Kopfzeile 4", () => {
    const b = blaetterUebersicht(datei(), "t.xlsx");
    expect(b.map((x) => [x.name, x.tabelle, x.kopfzeile])).toEqual([
      ["Erhebung Biomasse", true, 4],
      ["Bedarfe", true, 1],
      ["Legende", false, null],
      ["Testfälle (nicht importieren)", true, 1],
    ]);
  });

  it("Kopfzeile in Zeile 4 wird erkannt; Titelzeilen ignoriert, Leerzeile, Summenzeile (Formel) und Fussnote uebersprungen", () => {
    const t = parseImportDatei(datei(), "t.xlsx");
    expect(t.blatt).toBe("Erhebung Biomasse");
    expect(t.kopfzeile).toBe(4);
    expect(t.spalten.slice(0, 6)).toEqual(["Nr", "Betrieb / Firma", "Straße", "Hausnr.", "PLZ", "Ort"]);
    expect(t.zeilen).toHaveLength(36);
    expect(t.zeilennummern[0]).toBe(5);
    expect(t.zeilennummern[t.zeilennummern.length - 1]).toBe(41);
    expect(t.zeilennummern).not.toContain(35); // Leerzeile
    expect(t.uebersprungen).toEqual({ oben: 3, leer: 2, summe: 1, fuss: 1 });
    expect(t.vorschau[0]![1]).toBe("Betrieb / Firma");
  });

  it("Blatt waehlbar: Bedarfe mit Kopfzeile 1 und acht Zeilen", () => {
    const t = parseImportDatei(datei(), "t.xlsx", { blatt: "Bedarfe" });
    expect(t.kopfzeile).toBe(1);
    expect(t.spalten[0]).toBe("Abnehmer");
    expect(t.zeilen).toHaveLength(8);
  });

  it("Rot: Legende ohne Kopfzeile wird abgewiesen, mit Hinweis auf die Handwahl", () => {
    expect(() => parseImportDatei(datei(), "t.xlsx", { blatt: "Legende" })).toThrow(/keine Kopfzeile erkennbar/);
    expect(() => parseImportDatei(datei(), "t.xlsx", { blatt: "Gibt es nicht" })).toThrow(/gibt es in der Datei nicht/);
  });

  it("Kopfzeile von Hand: Zeile 2 statt 4 macht die Titelzeile zur Kopfzeile", () => {
    const t = parseImportDatei(datei(), "t.xlsx", { kopfzeile: 2 });
    expect(t.kopfzeile).toBe(2);
    expect(t.uebersprungen.oben).toBe(1);
    expect(t.zeilennummern[0]).toBe(4);
  });

  it("erkenneKopfzeile: Zeile mit einer Zelle ist keine Kopfzeile, Zahlenzeile auch nicht", () => {
    expect(erkenneKopfzeile([["Titel"], [], ["A", "B", "C"], [1, 2, 3]])).toBe(3);
    expect(erkenneKopfzeile([[1, 2, 3], [4, 5, 6]])).toBeNull();
    expect(erkenneKopfzeile([["A", "B"]])).toBe(1); // Kandidat ohne Datenblock — der Parser meldet dann „keine Datenzeile"
  });
});

describe("Datumszellen ohne Zeitzone (PR f, Befund CI 07.10.2026)", () => {
  it("rechnet die Excel-Seriennummer mit Datumsformat direkt in JJJJ-MM-TT um; ohne Datumsformat bleibt die Zahl eine Zahl", () => {
    expect(datumAusSeriennummer(46296, "dd\\.mm\\.yyyy")).toBe("2026-10-01");
    expect(datumAusSeriennummer(46387, "yyyy-mm-dd")).toBe("2026-12-31");
    expect(datumAusSeriennummer(4500, "#,##0")).toBeNull();
    expect(datumAusSeriennummer(4500, undefined)).toBeNull();
  });
  it("die Testdatei liefert in jeder Zeitzone dieselben Daten (Zeile 28: 01.10.2026 und 31.01.2027)", () => {
    const t = parseImportDatei(fixture("import-testdatei-ap27.xlsx"), "import-testdatei-ap27.xlsx", { blatt: "Erhebung Biomasse" });
    const z = t.zeilen[t.zeilennummern.indexOf(28)]!;
    expect([z[10], z[11]]).toEqual(["2026-10-01", "2027-01-31"]);
    expect(t.zeilen[t.zeilennummern.indexOf(5)]![8]).toBe("4500");
  });
});
