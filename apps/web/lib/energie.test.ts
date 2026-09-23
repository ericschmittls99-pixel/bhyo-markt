import { describe, expect, it } from "vitest";

import { energieKwh, fmtOutputPreis, preisEuroMwh, preisEuroT } from "./energie";

describe("energieKwh", () => {
  it("nimmt MWh/a direkt (Strom, Waerme, direkte Energieangaben)", () => {
    expect(energieKwh("strom", 500, "MWh/a")).toBe(500_000);
    expect(energieKwh("waerme", 5800, "MWh/a")).toBe(5_800_000);
  });

  it("rechnet t/a ueber den unteren Heizwert um (H2 33,33 kWh/kg)", () => {
    // 120 t * 1000 kg * 119,972/3,6 kWh/kg = 3.999.066,67 kWh
    expect(energieKwh("h2_niederdruck", 120, "t/a")).toBeCloseTo(3_999_066.67, 1);
    expect(energieKwh("liquid_hydrogen", 1, "t/a")).toBeCloseTo(33_325.6, 1);
    expect(energieKwh("methanol", 1, "t/a")).toBeCloseTo(5_527.8, 1);
  });

  it("rechnet Nm³/a nur fuer Gase mit Volumen-Heizwert um", () => {
    expect(energieKwh("methan", 1000, "Nm³/a")).toBeCloseTo(9_967.5, 1);
    expect(energieKwh("h2_hochdruck", 1000, "Nm³/a")).toBeCloseTo(2_995.3, 1);
    expect(energieKwh("methanol", 1000, "Nm³/a")).toBeNull();
  });

  it("nutzt fuer Synthesegas und BioFuels die Referenz-Heizwerte (E13)", () => {
    // Synthesegas 12 MJ/Nm³ bzw. 13,3 MJ/kg; BioFuels (FAME) 37,0 MJ/kg (RED II)
    expect(energieKwh("synthesegas", 10, "t/a")).toBeCloseTo(36_944.4, 1);
    expect(energieKwh("synthesegas", 1000, "Nm³/a")).toBeCloseTo(3_333.3, 1);
    expect(energieKwh("biofuels", 10, "t/a")).toBeCloseTo(102_777.8, 1);
    expect(energieKwh("synthesegas", 100, "MWh/a")).toBe(100_000);
  });

  it("liefert null fuer stoffliche Produkte", () => {
    expect(energieKwh("co2", 800, "t/a")).toBeNull();
    expect(energieKwh("asche", 240, "t/a")).toBeNull();
  });

  it("liefert null bei fehlender Menge oder Einheit", () => {
    expect(energieKwh("h2_niederdruck", null, "t/a")).toBeNull();
    expect(energieKwh("h2_niederdruck", 120, null)).toBeNull();
  });
});

// E20: Anzeigeeinheit energetischer Preise ist €/MWh (vorher ct/kWh).
describe("preisEuroMwh", () => {
  it("uebernimmt €/MWh direkt (auch Waerme ohne Heizwert)", () => {
    expect(preisEuroMwh("waerme", 80, "€/MWh")).toBe(80);
    expect(preisEuroMwh("strom", 120, "€/MWh")).toBe(120);
  });

  it("rechnet €/kg, €/t und €/Nm³ ueber den Heizwert um", () => {
    expect(preisEuroMwh("h2_niederdruck", 5, "€/kg")).toBeCloseTo(150.0, 0);
    expect(preisEuroMwh("saf", 2000, "€/t")).toBeCloseTo(166.9, 1);
    expect(preisEuroMwh("methan", 1, "€/Nm³")).toBeCloseTo(100.3, 1);
  });

  it("rechnet Synthesegas ueber den Referenz-Heizwert, Waerme nur ueber €/MWh", () => {
    // 100 €/t / (13,3/3,6 kWh/kg * 1000) * 1000 = 27,1 €/MWh
    expect(preisEuroMwh("synthesegas", 100, "€/t")).toBeCloseTo(27.1, 1);
    expect(preisEuroMwh("waerme", 5, "€/kg")).toBeNull();
  });
});

// E20: Anzeigeeinheit stofflicher Preise ist €/t (vorher €/kg).
describe("preisEuroT", () => {
  it("uebernimmt €/t direkt und rechnet €/kg auf €/t um", () => {
    expect(preisEuroT(80, "€/t")).toBe(80);
    expect(preisEuroT(0.1, "€/kg")).toBeCloseTo(100, 5);
    expect(preisEuroT(80, "€/MWh")).toBeNull();
    expect(preisEuroT(null, "€/t")).toBeNull();
  });
});

// E20: Beleg-Detail zeigt nicht mehr die erfasste Einheit roh, sondern
// rechnet in die Anzeigeeinheit um (€/MWh energetisch, €/t stofflich).
describe("fmtOutputPreis", () => {
  it("rechnet stoffliche Preise auf €/t um", () => {
    expect(fmtOutputPreis("co2", 0.25, "€/kg")).toBe("250 €/t");
    expect(fmtOutputPreis("asche", 25, "€/t")).toBe("25 €/t");
  });

  it("rechnet energetische Preise auf €/MWh um", () => {
    expect(fmtOutputPreis("h2_niederdruck", 185, "€/MWh")).toBe("185 €/MWh");
    expect(fmtOutputPreis("h2_niederdruck", 5, "€/kg")).toBe("150 €/MWh");
  });

  it("zeigt nicht umrechenbare Preise roh in erfasster Genauigkeit", () => {
    expect(fmtOutputPreis("waerme", 0.25, "€/kg")).toBe("0,25 €/kg");
  });

  it("zeigt ohne Preis einen Strich", () => {
    expect(fmtOutputPreis("co2", null, "€/kg")).toBe("–");
  });
});
