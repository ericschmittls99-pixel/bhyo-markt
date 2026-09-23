import { describe, expect, it } from "vitest";

import {
  saisonAchse,
  saisonAnteilBruch,
  saisonAnteileProzent,
  saisonZuIndex,
} from "./saison";

// Bestandsprofil (Summe 100, alte Formular-Konvention): STROH aus dem Seed.
const STROH = [1, 1, 2, 3, 5, 8, 20, 26, 18, 9, 4, 3];

describe("saisonAnteilBruch (Skala ist bedeutungslos, nur Verhaeltnisse)", () => {
  it("liefert fuer einen Bestandsbeleg exakt die bisherigen Anteile", () => {
    // Vorher: wert/100. Nachher: wert/Summe. Bestand summiert auf 100 -> identisch.
    for (let m = 0; m < 12; m++) {
      expect(saisonAnteilBruch(STROH, m)).toBeCloseTo(STROH[m]! / 100, 12);
    }
    // Und dieselben Anteile, wenn dasselbe Profil als Index gespeichert ist.
    const index = saisonZuIndex(STROH);
    for (let m = 0; m < 12; m++) {
      expect(saisonAnteilBruch(index, m)).toBeCloseTo(STROH[m]! / 100, 12);
    }
  });

  it("Ein Monat 200, Rest 100: Anteile 200/1300 bzw. 100/1300", () => {
    const werte = [200, ...Array(11).fill(100)];
    expect(saisonAnteilBruch(werte, 0)).toBeCloseTo(200 / 1300, 12);
    expect(saisonAnteilBruch(werte, 5)).toBeCloseTo(100 / 1300, 12);
  });
});

describe("saisonAnteileProzent (Anzeige, Largest Remainder)", () => {
  it("Gleichverteilung: alle zwoelf Index 100 -> Anteile je 1/12, Summe exakt 100", () => {
    const anteile = saisonAnteileProzent(Array(12).fill(100));
    expect(anteile.reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.min(...anteile)).toBe(8);
    expect(Math.max(...anteile)).toBe(9);
  });

  it("bleibt bei Bestandsprofilen bei den bisherigen Prozenten", () => {
    expect(saisonAnteileProzent(STROH)).toEqual(STROH);
  });
});

describe("saisonZuIndex (Editor-Ansicht)", () => {
  it("hebt Bestandsprofile auf die Index-Skala (flach = 100)", () => {
    const index = saisonZuIndex(Array(12).fill(100 / 12));
    for (const v of index) expect(v).toBeCloseTo(100, 9);
  });

  it("normiert jede Skala aufs Mittel 100 und erhaelt die Verhaeltnisse", () => {
    const idx = saisonZuIndex([200, ...Array(11).fill(100)]);
    expect(idx.reduce((a, b) => a + b, 0) / 12).toBeCloseTo(100, 9);
    expect(idx[0]! / idx[1]!).toBeCloseTo(2, 9);
    expect(saisonZuIndex(Array(12).fill(0))).toEqual(Array(12).fill(0));
  });
});

describe("saisonAchse (fest 0-200, einmaliger 50er-Sprung)", () => {
  it("bleibt bei 200, solange kein Wert darueber liegt", () => {
    expect(saisonAchse([200, ...Array(11).fill(100)])).toBe(200);
    expect(saisonAchse(Array(12).fill(0))).toBe(200);
  });

  it("springt bei 240 auf 250 — kein Clipping", () => {
    expect(saisonAchse([240, ...Array(11).fill(100)])).toBe(250);
    expect(saisonAchse([301, ...Array(11).fill(100)])).toBe(350);
  });
});
