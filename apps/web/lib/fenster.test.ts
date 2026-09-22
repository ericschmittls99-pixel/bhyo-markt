import { describe, expect, it } from "vitest";

import {
  fensterFaktor,
  fensterKategorien,
  jahresAnteil,
  wendeFensterAn,
} from "./fenster";
import type { Strom } from "./stroeme-modell";
import type { VergabeDaten } from "./verfuegbarkeit";

const basis = {
  id: "",
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2035-12-31",
  reserviertBhyo: false,
  saisonalitaet: null,
} as Strom;
const v = (o: Partial<VergabeDaten>): VergabeDaten => ({
  vergebenVon: null,
  vergebenBis: null,
  vergebenAn: null,
  anBhyo: false,
  ...o,
});

describe("jahresAnteil (Handoff: Rate × Σ Saisonanteile)", () => {
  it("Gleichverteilung: n Monate ÷ 12 — Beleg ab 07/2026 zaehlt 2026 mit 6/12", () => {
    const s = { ...basis, zeitraumVon: "2026-07-01" } as Strom;
    expect(jahresAnteil(2026, s, [], null)).toBeCloseTo(6 / 12, 10);
    expect(jahresAnteil(2027, s, [], null)).toBeCloseTo(1, 10);
    expect(jahresAnteil(2025, s, [], null)).toBe(0);
  });

  it("Saisonprofil: Jul-Dez-Anteile statt 6/12", () => {
    const saison = [0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 50]; // Σ 100
    const s = { ...basis, zeitraumVon: "2026-07-01", saisonalitaet: saison } as Strom;
    expect(jahresAnteil(2026, s, [], null)).toBeCloseTo(1, 10);
  });

  it("Teilvergabe (Handoff-Beispiel): vergeben bis 06/2028 — bis dahin vergeben, ab 07/2028 frei", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    const frei = new Set(["verfuegbar"] as const);
    const extern = new Set(["vergeben_extern"] as const);
    expect(jahresAnteil(2027, basis, vergaben, frei)).toBe(0);
    expect(jahresAnteil(2027, basis, vergaben, extern)).toBeCloseTo(1, 10);
    expect(jahresAnteil(2028, basis, vergaben, frei)).toBeCloseTo(6 / 12, 10);
    expect(jahresAnteil(2028, basis, vergaben, extern)).toBeCloseTo(6 / 12, 10);
  });

  it("freie Monate mit Reservierung zaehlen als reserviert_bhyo, nicht als verfuegbar", () => {
    const s = { ...basis, reserviertBhyo: true } as Strom;
    expect(jahresAnteil(2027, s, [], new Set(["verfuegbar"]))).toBe(0);
    expect(jahresAnteil(2027, s, [], new Set(["reserviert_bhyo"]))).toBeCloseTo(1, 10);
  });
});

describe("fensterKategorien", () => {
  it("uebergreifendes Fenster: anteilig in beiden Kategorien", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    const k = fensterKategorien([2026, 2027, 2028, 2029, 2030], basis, vergaben);
    expect(k.has("vergeben_extern")).toBe(true);
    expect(k.has("verfuegbar")).toBe(true);
  });

  it("Fenster nur 2026-2027: nur vergeben (extern)", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    const k = fensterKategorien([2026, 2027], basis, vergaben);
    expect(k.has("vergeben_extern")).toBe(true);
    expect(k.has("verfuegbar")).toBe(false);
  });

  it("Verfuegbarkeit komplett vor dem Fenster -> abgelaufen", () => {
    const s = { ...basis, zeitraumVon: "2025-01-01", zeitraumBis: "2025-12-31" } as Strom;
    expect(fensterKategorien([2030], s, [])).toEqual(new Set(["abgelaufen"]));
  });

  it("Verfuegbarkeit komplett nach dem Fenster -> noch_nicht_verfuegbar", () => {
    const s = { ...basis, zeitraumVon: "2030-01-01", zeitraumBis: "2035-12-31" } as Strom;
    expect(fensterKategorien([2026], s, [])).toEqual(
      new Set(["noch_nicht_verfuegbar"]),
    );
  });
});

describe("fensterFaktor", () => {
  it("Einzeljahr: oe und Summe identisch", () => {
    expect(fensterFaktor([2027], basis, [], null, "oe")).toBeCloseTo(
      fensterFaktor([2027], basis, [], null, "summe"),
      10,
    );
  });

  it("Zeitraum: Summe = Σ Jahre, oe = Summe ÷ Jahre", () => {
    const jahre = [2026, 2027];
    expect(fensterFaktor(jahre, basis, [], null, "summe")).toBeCloseTo(2, 10);
    expect(fensterFaktor(jahre, basis, [], null, "oe")).toBeCloseTo(1, 10);
  });
});

describe("wendeFensterAn", () => {
  it("skaliert die Mengenfelder und filtert nach Fensterkategorien", () => {
    const s1 = { ...basis, id: "a", art: "biomasse", mengeAtro: 100, mengeFm: 200 } as Strom;
    const s2 = {
      ...basis,
      id: "b",
      art: "biomasse",
      mengeAtro: 100,
      mengeFm: 200,
      zeitraumVon: "2025-01-01",
      zeitraumBis: "2025-12-31",
    } as Strom;
    const map = new Map([["a", [v({ vergebenBis: "2027-06-30" })]]]);
    const erg = wendeFensterAn([s1, s2], map, [2027], ["verfuegbar"], "oe");
    expect(erg.map((s) => s.id)).toEqual(["a"]);
    expect(erg[0]!.mengeAtro).toBeCloseTo(50, 10);
    expect(erg[0]!.mengeFm).toBeCloseTo(100, 10);
  });

  it("ohne Status-Auswahl zaehlen alle vier Mengen-Kategorien; abgelaufene bleiben mit Menge 0", () => {
    const s2 = {
      ...basis,
      id: "b",
      art: "biomasse",
      mengeAtro: 100,
      zeitraumVon: "2025-01-01",
      zeitraumBis: "2025-12-31",
    } as Strom;
    const erg = wendeFensterAn([s2], new Map(), [2027], [], "oe");
    expect(erg).toHaveLength(1);
    expect(erg[0]!.mengeAtro).toBe(0);
  });
});
