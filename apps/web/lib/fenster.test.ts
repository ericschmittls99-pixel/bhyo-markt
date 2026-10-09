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

  // E23-Seitencheck E19: seit der Index-Konvention (23.09.2026) summieren
  // Profile nicht mehr auf 100 — die Anteile muessen trotzdem exakt
  // wert/Summe bleiben (saisonAnteilBruch teilt durch die echte Summe).
  it("Index-Profil (Σ 1200): ganzjaehrig zaehlt exakt 1", () => {
    const saison = [150, 150, 100, 100, 100, 100, 100, 100, 100, 100, 50, 50];
    const s = { ...basis, saisonalitaet: saison } as Strom;
    expect(jahresAnteil(2027, s, [], null)).toBeCloseTo(1, 10);
  });

  it("Index-Profil (Σ 1200): Q1-Verfuegbarkeit zaehlt exakt 400/1200", () => {
    const saison = [150, 150, 100, 100, 100, 100, 100, 100, 100, 100, 50, 50];
    const s = {
      ...basis,
      zeitraumVon: "2027-01-01",
      zeitraumBis: "2027-03-31",
      saisonalitaet: saison,
    } as Strom;
    expect(jahresAnteil(2027, s, [], null)).toBeCloseTo(400 / 1200, 10);
  });

  // Regression (Eric, 23.09.2026): die Normierung auf die TATSAECHLICHE
  // Profilsumme ist gewollt — ein Sigma-1300-Profil teilt durch 1300.
  it("Index-Profil (Σ 1300): Q1 zaehlt exakt 500/1300", () => {
    const saison = [250, 150, 100, 100, 100, 100, 100, 100, 100, 100, 50, 50];
    const s = {
      ...basis,
      zeitraumVon: "2027-01-01",
      zeitraumBis: "2027-03-31",
      saisonalitaet: saison,
    } as Strom;
    expect(jahresAnteil(2027, s, [], null)).toBeCloseTo(500 / 1300, 10);
  });

  it("freie Monate mit Reservierung zaehlen als reserviert_bhyo, nicht als verfuegbar", () => {
    const s = { ...basis, reserviertBhyo: true } as Strom;
    expect(jahresAnteil(2027, s, [], new Set(["verfuegbar"]))).toBe(0);
    expect(jahresAnteil(2027, s, [], new Set(["reserviert_bhyo"]))).toBeCloseTo(1, 10);
  });
});

describe("E75: zeitraumBis = null heisst unbefristet (Monatsraster)", () => {
  const offen = { ...basis, zeitraumBis: null } as Strom;
  it("Rot-Nachweis: unbefristeter Strom zaehlt in jedem Jahr ab Beginn voll", () => {
    expect(jahresAnteil(2026, offen, [], null)).toBeCloseTo(1, 10);
    expect(jahresAnteil(2040, offen, [], null)).toBeCloseTo(1, 10);
    expect(jahresAnteil(2025, offen, [], null)).toBe(0);
  });
  it("Vergabe ohne Ende auf unbefristetem Strom: alle Monate ab Vergabebeginn vergeben", () => {
    const vg = [v({ vergebenVon: "2026-07-01" })];
    expect(jahresAnteil(2026, offen, vg, new Set(["vergeben_extern"]))).toBeCloseTo(6 / 12, 10);
    expect(jahresAnteil(2035, offen, vg, new Set(["vergeben_extern"]))).toBeCloseTo(1, 10);
    expect(jahresAnteil(2035, offen, vg, new Set(["verfuegbar"]))).toBe(0);
  });
  it("unbefristet ist nie abgelaufen; vor dem Beginn noch_nicht_verfuegbar", () => {
    expect(fensterKategorien([2090], offen, []).has("abgelaufen")).toBe(false);
    expect(fensterKategorien([2090], offen, []).has("verfuegbar")).toBe(true);
    expect(fensterKategorien([2020], offen, []).has("noch_nicht_verfuegbar")).toBe(true);
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
  // E41: Stroeme filtert das Filtermodell (Status im Fenster), nicht mehr
  // diese Funktion — sie skaliert nur noch nach den gewaehlten Kategorien.
  it("skaliert die Mengenfelder nach den gewaehlten Fensterkategorien, filtert aber keine Stroeme", () => {
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
    expect(erg.map((s) => s.id)).toEqual(["a", "b"]);
    expect(erg[0]!.mengeAtro).toBeCloseTo(50, 10);
    expect(erg[0]!.mengeFm).toBeCloseTo(100, 10);
    expect(erg[1]!.mengeAtro).toBe(0);
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
