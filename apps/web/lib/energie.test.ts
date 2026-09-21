import { describe, expect, it } from "vitest";

import { energieKwh, preisCtKwh, preisEuroKg } from "./energie";

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
    // Synthesegas 12 MJ/Nm³ bzw. 13,3 MJ/kg; BioFuels (FAME) 37,5 MJ/kg
    expect(energieKwh("synthesegas", 10, "t/a")).toBeCloseTo(36_944.4, 1);
    expect(energieKwh("synthesegas", 1000, "Nm³/a")).toBeCloseTo(3_333.3, 1);
    expect(energieKwh("biofuels", 10, "t/a")).toBeCloseTo(104_166.7, 1);
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

describe("preisCtKwh", () => {
  it("rechnet €/MWh direkt um (auch Waerme ohne Heizwert)", () => {
    expect(preisCtKwh("waerme", 80, "€/MWh")).toBe(8);
    expect(preisCtKwh("strom", 120, "€/MWh")).toBe(12);
  });

  it("rechnet €/kg, €/t und €/Nm³ ueber den Heizwert um", () => {
    expect(preisCtKwh("h2_niederdruck", 5, "€/kg")).toBeCloseTo(15.0, 1);
    expect(preisCtKwh("saf", 2000, "€/t")).toBeCloseTo(16.69, 2);
    expect(preisCtKwh("methan", 1, "€/Nm³")).toBeCloseTo(10.03, 2);
  });

  it("rechnet Synthesegas ueber den Referenz-Heizwert, Waerme nur ueber €/MWh", () => {
    // 100 €/t / (13,3/3,6 kWh/kg * 1000) * 100 = 2,71 ct/kWh
    expect(preisCtKwh("synthesegas", 100, "€/t")).toBeCloseTo(2.71, 2);
    expect(preisCtKwh("waerme", 5, "€/kg")).toBeNull();
  });
});

describe("preisEuroKg", () => {
  it("rechnet €/t auf €/kg um, €/kg direkt", () => {
    expect(preisEuroKg(80, "€/t")).toBeCloseTo(0.08, 5);
    expect(preisEuroKg(0.1, "€/kg")).toBe(0.1);
    expect(preisEuroKg(80, "€/MWh")).toBeNull();
    expect(preisEuroKg(null, "€/t")).toBeNull();
  });
});
