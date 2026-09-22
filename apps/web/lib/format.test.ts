import { describe, expect, it } from "vitest";

import {
  fmtAnteil,
  fmtFaktor,
  fmtGeldGross,
  fmtMenge,
  fmtPreis,
  fmtQuote,
  fmtZahlungsstrom,
  rundeAnteile100,
} from "./format";

// E20: keine Nachkommastellen in der Darstellung — passt eine Groesse
// nicht, wechselt die EINHEIT, nicht die Regel. Genau zwei Ausnahmen:
// a) Mio.-Darstellung (eine Nachkommastelle), b) Faktoren sichtbarer
// Rechenketten (erfasste Genauigkeit).
describe("E20-Formatierung je Groessenart", () => {
  it("fmtMenge: ganzzahlig mit Tausenderpunkt", () => {
    expect(fmtMenge(60389.4)).toBe("60.389");
    expect(fmtMenge(0)).toBe("0");
  });

  it("fmtPreis: ganzzahlig und signiert — keine Nachkommastellen", () => {
    expect(fmtPreis(-78.89)).toBe("-79");
    expect(fmtPreis(4.5)).toBe("5");
    expect(fmtPreis(185)).toBe("185");
    expect(fmtPreis(-124)).toBe("-124");
  });

  it("fmtQuote: ganzzahlige Prozentangabe", () => {
    expect(fmtQuote(87.4)).toBe("87 %");
    expect(fmtQuote(0)).toBe("0 %");
  });

  it("fmtAnteil: ganzzahliger Anteil", () => {
    expect(fmtAnteil(8.33)).toBe("8 %");
    expect(fmtAnteil(26.3)).toBe("26 %");
  });

  it("fmtGeldGross: ab 1 Mio genau EINE Nachkommastelle (Ausnahme a)", () => {
    expect(fmtGeldGross(30_350_000)).toEqual({ wert: "30,4", einheit: "Mio. €/a" });
    expect(fmtGeldGross(-2_470_000)).toEqual({ wert: "-2,5", einheit: "Mio. €/a" });
    expect(fmtGeldGross(1_000_000)).toEqual({ wert: "1,0", einheit: "Mio. €/a" });
  });

  it("fmtGeldGross: unter 1 Mio ganzzahlig in €/a", () => {
    expect(fmtGeldGross(992_396.4)).toEqual({ wert: "992.396", einheit: "€/a" });
    expect(fmtGeldGross(-763_425)).toEqual({ wert: "-763.425", einheit: "€/a" });
  });

  it("fmtFaktor: Rechenketten-Faktoren behalten die erfasste Genauigkeit (Ausnahme b)", () => {
    expect(fmtFaktor(8.5)).toBe("8,5"); // TS-Anteil
    expect(fmtFaktor(0.875)).toBe("0,875"); // Aschegehalt als Faktor
    expect(fmtFaktor(1.25)).toBe("1,25"); // Umwegfaktor
    expect(fmtFaktor(90)).toBe("90");
  });

  it("fmtZahlungsstrom: Label aus dem Vorzeichen (E14), Betrag ganzzahlig (E20)", () => {
    expect(fmtZahlungsstrom(12)).toBe("Einkaufspreis 12 €/t");
    expect(fmtZahlungsstrom(-8.5)).toBe("Annahmeentgelt 9 €/t");
    expect(fmtZahlungsstrom(0)).toBe("Einkaufspreis 0 €/t");
  });
});

describe("rundeAnteile100 (Largest Remainder)", () => {
  it("rundet 12 Saisonanteile ganzzahlig mit Summe exakt 100", () => {
    const roh = [1, 1, 2, 3, 5, 8, 20.5, 25.8, 18.2, 9.1, 3.7, 2.7];
    const ganz = rundeAnteile100(roh);
    expect(ganz.reduce((a, b) => a + b, 0)).toBe(100);
    expect(ganz.every(Number.isInteger)).toBe(true);
    // Die drei groessten Reste (+1): 25,8 → 26; 3,7 → 4; bei Restgleichheit
    // (2,7) gewinnt der fruehere Index — 18,2 und 9,1 bleiben abgerundet.
    expect(ganz).toEqual([1, 1, 2, 3, 5, 8, 20, 26, 18, 9, 4, 3]);
  });

  it("macht aus der Formular-Gleichverteilung (11 × 8,33 + 8,37) exakt 100", () => {
    const roh = [...Array.from({ length: 11 }, () => 8.33), 8.37];
    const ganz = rundeAnteile100(roh);
    expect(ganz.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.max(...ganz)).toBe(9);
    expect(Math.min(...ganz)).toBe(8);
  });
});
