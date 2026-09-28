import { describe, expect, it } from "vitest";

import {
  beimWechselZuEinzeljahr,
  beimWechselZuZeitraum,
  bereichVon,
  jahreImBereich,
  jahreParam,
  klemme,
  reglerGrenzen,
  uhrText,
} from "./jahr-regler";

describe("E39 Jahres-Regler", () => {
  it("Grenzen: frühestes bis spätestes Jahr der Achse", () => {
    expect(reglerGrenzen([2020, 2021, 2022, 2036])).toEqual({ min: 2020, max: 2036 });
    expect(reglerGrenzen([2026])).toEqual({ min: 2026, max: 2026 });
    expect(() => reglerGrenzen([])).toThrow();
  });
  it("Griffe werden auf die Grenzen geklemmt und auf ganze Jahre gerundet", () => {
    expect(klemme(2019, 2020, 2036)).toBe(2020);
    expect(klemme(2040, 2020, 2036)).toBe(2036);
    expect(klemme(2025.6, 2020, 2036)).toBe(2026);
  });
  it("Zeitraum ist lückenlos, Griffreihenfolge egal", () => {
    expect(jahreImBereich(2027, 2024)).toEqual([2024, 2025, 2026, 2027]);
    expect(jahreImBereich(2026, 2026)).toEqual([2026]);
  });
  it("Wechsel Zeitraum → Einzeljahr nimmt das Endjahr, zurück wird [Jahr, Jahr]", () => {
    expect(beimWechselZuEinzeljahr([2023, 2024, 2026])).toBe(2026);
    expect(beimWechselZuZeitraum(2026)).toEqual([2026]);
    expect(jahreParam(beimWechselZuZeitraum(2026))).toBe("2026");
  });
  it("Uhr-Text: Einzeljahr 2026, Zeitraum 2023–2026, Ein-Jahr-Zeitraum 2026", () => {
    expect(uhrText("einzeljahr", [2026])).toBe("2026");
    expect(uhrText("zeitraum", [2023, 2024, 2025, 2026])).toBe("2023–2026");
    expect(uhrText("zeitraum", [2026])).toBe("2026");
  });
  it("alte Adresse mit Lücken: Regler zeigt min–max, die Liste bleibt unangetastet", () => {
    expect(bereichVon([2024, 2027])).toEqual({ von: 2024, bis: 2027 });
    expect(uhrText("zeitraum", [2024, 2027])).toBe("2024–2027");
  });
});
