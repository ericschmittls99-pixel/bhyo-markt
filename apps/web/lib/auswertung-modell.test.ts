import { describe, expect, it } from "vitest";

import {
  auswahlZeile,
  belegtypZeilen,
  clusterZeilen,
  jahresBalken,
  kpiKarten,
  outputJahre,
  outputMengen,
  outputPotenzialZeilen,
  outputPreisZeilen,
  preisKorridorZeilen,
  saldoZeilen,
  qualitaetsDaten,
  saisonDaten,
  statusZeilen,
  verifZeilen,
} from "./auswertung-modell";
import type { Strom, StromBeleg } from "./stroeme-modell";

const beleg = (patch: Partial<StromBeleg>): StromBeleg => ({
  typ: "vertrag",
  quellenangabe: null,
  href: null,
  externNachvollziehbar: false,
  gueltigBis: null,
  erhebungsdatum: null,
  amtlich: null,
  gespraechsdatum: null,
  gespraechspartner: null,
  kernnotiz: null,
  ...patch,
});

const strom = (patch: Partial<Strom>): Strom => ({
  id: "x",
  art: "biomasse",
  akteurName: "A",
  sektor: null,
  bezeichnung: null,
  kontaktperson: null,
  ort: null,
  landkreis: null,
  regionIds: [],
  regionNamen: [],
  lng: null,
  lat: null,
  cluster: null,
  materialartCode: null,
  materialartLabel: null,
  mengeFm: null,
  tsAnteil: null,
  aschegehalt: null,
  mengeAtro: null,
  preisMin: null,
  preisMittel: null,
  preisMax: null,
  preisHerkunft: null,
  gruppe: null,
  gruppeLabel: null,
  produktCode: null,
  produktLabel: null,
  kategorie: null,
  mengeWert: null,
  mengeEinheit: null,
  preis: null,
  preisEinheit: null,
  zeitraumVon: null,
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: null,
  status: "entwurf",
  erstelltAm: "2026-09-01",
  beleg: null,
  vollstaendigkeit: 0,
  ...patch,
});

// Fixture: 2 Feedstock + 1 Output — Referenz fuer alle Kennzahlen.
const f1 = strom({
  id: "f1",
  cluster: "organische_rest_abfallstoffe",
  materialartLabel: "Gülle",
  mengeAtro: 100,
  mengeFm: 1000,
  status: "geprueft",
  vollstaendigkeit: 80,
  qualitaet: "A",
  preisMin: 5,
  preisMittel: 10,
  preisMax: 20,
  saisonalitaet: [110, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 90],
  zeitraumVon: "2027-01-01",
  zeitraumBis: "2029-12-31",
  beleg: beleg({ typ: "vertrag", erhebungsdatum: "2026-03-10" }),
});
const f2 = strom({
  id: "f2",
  cluster: "lignozellulosische_reststoffe",
  mengeAtro: 50,
  mengeFm: 500,
  status: "entwurf",
  vollstaendigkeit: 40,
  qualitaet: "B",
  preisMin: 8,
  preisMittel: 16,
  preisMax: 24,
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2031-12-31",
  beleg: beleg({ typ: "gespraech", erhebungsdatum: "2026-08-01" }),
});
const o1 = strom({
  id: "o1",
  art: "output",
  gruppe: "wasserstoff",
  produktCode: "h2_niederdruck",
  produktLabel: "Wasserstoff",
  kategorie: "target",
  mengeWert: 500,
  mengeEinheit: "MWh/a",
  status: "in_pruefung",
  vollstaendigkeit: 60,
  qualitaet: "A",
  preis: 8,
  preisEinheit: "€/MWh",
  zeitraumVon: "2026-06-01",
  zeitraumBis: "2028-06-30",
  beleg: beleg({ typ: "angebot", erhebungsdatum: "2026-09-01", gueltigBis: "2026-10-01" }),
});
const alle = [f1, f2, o1];

describe("kpiKarten", () => {
  it("liefert Pruefquote, Trockenmasse, getrennte ø-Preise und Feedstock-Saldo (sicht=feedstock)", () => {
    const k = kpiKarten([f1, f2], "feedstock");
    expect(k).toHaveLength(4);
    expect(k[0]).toMatchObject({ wert: "50", einheit: "%", label: "belege geprüft." });
    expect(k[1]).toMatchObject({ wert: "150", einheit: "t atro/a", label: "trockenmasse." });
    // Beide positiv -> nur Einkaufspreis-Stat: (10*100 + 16*50) / 150 = 12
    expect(k[2]!.label).toBe("ø preise.");
    expect(k[2]!.stats).toEqual([
      { wert: "12", einheit: "€/t", label: "ø einkaufspreis (n=2)" },
    ]);
    expect(k[2]!.caption).toBe("atro-gewichtet");
    // Saldo 10*100 + 16*50 = 1.800; Spanne Σ(min*m) = 900 bis Σ(max*m) = 3.200
    expect(k[3]).toMatchObject({ wert: "1.800", einheit: "€/a", label: "feedstock-saldo." });
    expect(k[3]!.caption).toBe(
      "Spanne 900 – 3.200 €/a · Min/Max je Position, mengengewichtet",
    );
    expect(k[3]!.hinweis).toContain("Nettobeschaffungskosten");
    expect(k[3]!.hinweis).toContain("Nettoerlös");
  });

  it("trennt Einkaufspreise und Annahmeentgelte nach Vorzeichen (E14)", () => {
    // fN: bhyo ERHAELT 8 €/t (negativ), 100 t atro
    const fN = strom({
      id: "fn",
      cluster: "lignozellulosische_reststoffe",
      mengeAtro: 100,
      preisMin: -12,
      preisMittel: -8,
      preisMax: -5,
    });
    const k = kpiKarten([f1, fN], "feedstock");
    expect(k[2]!.stats).toEqual([
      { wert: "10", einheit: "€/t", label: "ø einkaufspreis (n=1)" },
      { wert: "8", einheit: "€/t", label: "ø annahmeentgelt (n=1)" },
    ]);
    // Saldo: 10*100 - 8*100 = 200; Spanne 5*100-12*100 = -700 bis 20*100-5*100 = 1.500
    expect(k[3]).toMatchObject({ wert: "200", einheit: "€/a" });
    expect(k[3]!.caption).toContain("Spanne -700 – 1.500 €/a");
  });

  it("ordnet einen Beleg mit Vorzeichenwechsel in der Spanne nach dem Mittel zu (E14)", () => {
    // Material, dessen Zahlungsstrom je Marktlage kippen kann: min -10 / max +15
    const wechsel = strom({
      id: "w",
      mengeAtro: 100,
      preisMin: -10,
      preisMittel: 5,
      preisMax: 15,
    });
    const k = kpiKarten([wechsel], "feedstock");
    expect(k[2]!.stats).toEqual([
      { wert: "5", einheit: "€/t", label: "ø einkaufspreis (n=1)" },
    ]);
    expect(k[3]).toMatchObject({ wert: "500", einheit: "€/a" });
    expect(k[3]!.caption).toContain("Spanne -1.000 – 1.500 €/a");
  });

  it("zeigt einen negativen Saldo mit sichtbarem Vorzeichen", () => {
    const fN = strom({ id: "fn", mengeAtro: 100, preisMittel: -8 });
    const k = kpiKarten([fN], "feedstock");
    expect(k[3]).toMatchObject({ wert: "-800", einheit: "€/a" });
  });

  it("weist Belege ohne Preis aus statt sie still zu ignorieren", () => {
    const ohnePreis = strom({ id: "n", cluster: "lipide_spezialfeedstocks", mengeAtro: 10 });
    const k = kpiKarten([f1, ohnePreis], "feedstock");
    expect(k[2]!.caption).toBe("atro-gewichtet · 1 Beleg ohne Preis");
    expect(k[3]).toMatchObject({ wert: "1.000", einheit: "€/a" });
  });

  it("zeigt ohne jeden Preis einen Strich statt 0", () => {
    const k = kpiKarten([strom({ id: "n", mengeAtro: 10 })], "feedstock");
    expect(k[2]).toMatchObject({ wert: "–", caption: "keine Preise in der Auswahl" });
    expect(k[3]!.wert).toBe("–");
  });

  it("skaliert grosse Salden vorzeichenerhaltend auf Mio. €/a", () => {
    const gross = strom({ id: "g", mengeAtro: 100000, preisMittel: 25 });
    expect(kpiKarten([gross], "feedstock")[3]).toMatchObject({
      wert: "2,50",
      einheit: "Mio. €/a",
    });
    const grossNegativ = strom({ id: "gn", mengeAtro: 100000, preisMittel: -25 });
    expect(kpiKarten([grossNegativ], "feedstock")[3]).toMatchObject({
      wert: "-2,50",
      einheit: "Mio. €/a",
    });
  });

  it("liefert bei sicht=outputs Pruefquote, Energiebedarf, ct/kWh-Preis und Potenzial", () => {
    // o1: 500 MWh/a, 8 €/MWh -> 0,8 ct/kWh; h2: 120 t/a = 3.999,07 MWh, 5 €/kg
    // -> 15,0035 ct/kWh; waerme: 5.800 MWh/a, 80 €/MWh; co2: 800 t/a, 80 €/t
    const h2 = strom({
      id: "oh2",
      art: "output",
      gruppe: "wasserstoff",
      produktCode: "h2_hochdruck",
      kategorie: "target",
      mengeWert: 120,
      mengeEinheit: "t/a",
      preis: 5,
      preisEinheit: "€/kg",
    });
    const waerme = strom({
      id: "ow",
      art: "output",
      gruppe: "add_ons",
      produktCode: "waerme",
      kategorie: "add_on",
      mengeWert: 5800,
      mengeEinheit: "MWh/a",
      preis: 80,
      preisEinheit: "€/MWh",
    });
    const co2 = strom({
      id: "oco2",
      art: "output",
      gruppe: "add_ons",
      produktCode: "co2",
      kategorie: "add_on",
      mengeWert: 800,
      mengeEinheit: "t/a",
      preis: 80,
      preisEinheit: "€/t",
    });
    const k = kpiKarten([o1, h2, waerme, co2], "outputs");
    expect(k).toHaveLength(4);
    expect(k[0]).toMatchObject({ einheit: "%", label: "belege geprüft." });
    // Targets nach Hu: 500 + 3.999,07 = 4.499 MWh/a
    expect(k[1]).toMatchObject({ wert: "4.499", einheit: "MWh/a", label: "energiebedarf." });
    expect(k[1]!.caption).toContain("dazu 800 t CO2/a");
    // kWh-gewichtet NUR ueber Target-Outputs (ohne Waerme):
    // (0,8*500 + 15,0035*3.999,07) / 4.499,07 = 13,43
    expect(k[2]).toMatchObject({ wert: "13,43", einheit: "ct/kWh", label: "ø preis." });
    expect(k[2]!.caption).toContain("Target-Outputs");
    // Potenzial: 500*8 + 600.000 + 5.800*80 + 800*80 = 1.132.000 -> 1,13 Mio
    expect(k[3]).toMatchObject({ wert: "1,13", einheit: "Mio. €/a", label: "erlöspotenzial." });
  });

  it("nutzt fuer Synthesegas in t/a den Referenz-Heizwert (E13)", () => {
    const syn = strom({
      id: "osyn",
      art: "output",
      gruppe: "primaerprodukte",
      produktCode: "synthesegas",
      kategorie: "target",
      mengeWert: 10,
      mengeEinheit: "t/a",
    });
    const k = kpiKarten([o1, syn], "outputs");
    // 500 + 36,94 MWh
    expect(k[1]).toMatchObject({ wert: "537", einheit: "MWh/a" });
    expect(k[1]!.caption).not.toContain("ohne Heizwert");
  });

  it("zeigt bei Outputs ohne Preise einen Strich", () => {
    const k = kpiKarten([{ ...o1, preis: null }], "outputs");
    expect(k[2]).toMatchObject({ wert: "–", caption: "keine Preise in der Auswahl" });
    expect(k[3]!.wert).toBe("–");
  });
});

describe("auswahlZeile", () => {
  it("nennt Belegzahl und mittleren Erfassungsgrad", () => {
    expect(auswahlZeile([f1, f2])).toBe(
      "2 Belege in der Auswahl (ø Erfassungsgrad 60 %)",
    );
    expect(auswahlZeile([f1])).toBe(
      "1 Beleg in der Auswahl (ø Erfassungsgrad 80 %)",
    );
  });
});

describe("clusterZeilen", () => {
  it("summiert t atro je Cluster, pct relativ zum Maximum, flache Clusterfarbe + Orb-Asset", () => {
    const z = clusterZeilen([f1, f2], [f1, f2], "feedstock");
    expect(z.map((r) => r.key)).toEqual([
      "organische_rest_abfallstoffe",
      "lignozellulosische_reststoffe",
    ]);
    expect(z[0]).toMatchObject({
      wertText: "100",
      pct: 100,
      farbe: "#5C8615",
      orb: "/orbs/cluster/organische_rest_abfallstoffe.webp",
    });
    expect(z[0]!.meta).toBe("1 Beleg · 67 %");
    expect(z[1]!.pct).toBe(50);
  });

  it("haelt Zeilen aus dem Pool sichtbar, auch wenn der Filter sie leert", () => {
    const z = clusterZeilen([f1, f2], [f1], "feedstock");
    expect(z).toHaveLength(2);
    expect(z[1]!.wertText).toBe("0");
  });

  it("gruppiert die Materialarten eines Clusters als Unterzeilen, groesste zuerst", () => {
    const g1 = strom({
      id: "g1",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "guelle",
      materialartLabel: "Gülle",
      mengeAtro: 100,
    });
    const g2 = strom({
      id: "g2",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "biotonne",
      materialartLabel: "Biotonne",
      mengeAtro: 300,
    });
    const z = clusterZeilen([g1, g2], [g1, g2], "feedstock");
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Biotonne", "Gülle"]);
    // Skala wie die Cluster-Balken: Maximum 400 t atro
    expect(z[0]!.unter[0]).toMatchObject({
      key: "biotonne",
      wertText: "300",
      pct: 75,
      meta: "1 Beleg",
    });
  });

  it("haelt Materialart-Unterzeilen aus dem Pool sichtbar, wenn der Filter sie leert", () => {
    const g1 = strom({
      id: "g1",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "guelle",
      materialartLabel: "Gülle",
      mengeAtro: 100,
    });
    const g2 = strom({
      id: "g2",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "biotonne",
      materialartLabel: "Biotonne",
      mengeAtro: 300,
    });
    const z = clusterZeilen([g1, g2], [g1], "feedstock");
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Gülle", "Biotonne"]);
    expect(z[0]!.unter[1]).toMatchObject({ wertText: "0", pct: 0, meta: "0 Belege" });
  });

  it("fasst Belege ohne Materialart-Code als nicht filterbare Unterzeile", () => {
    // f1 traegt nur ein Label (kein Code), f2 gar keine Materialart
    const z = clusterZeilen([f1, f2], [f1, f2], "feedstock");
    expect(z[0]!.unter[0]).toMatchObject({ key: "", label: "Gülle" });
    expect(z[1]!.unter[0]).toMatchObject({ key: "", label: "ohne Materialart" });
  });

  it("zaehlt bei sicht=outputs Belege je Gruppe ohne Unterzeilen; add_ons nutzt den waerme-Orb", () => {
    const addOn = strom({ id: "o2", art: "output", gruppe: "add_ons", mengeWert: 10, mengeEinheit: "t/a" });
    const z = clusterZeilen([o1, addOn], [o1, addOn], "outputs");
    expect(z.map((r) => r.key)).toEqual(["wasserstoff", "add_ons"]);
    expect(z[0]).toMatchObject({ wertText: "1 Beleg", meta: "500 MWh/a" });
    expect(z[0]!.unter).toEqual([]);
    expect(z[1]!.orb).toBe("/orbs/output/waerme.webp");
  });
});

describe("qualitaetsDaten", () => {
  it("bildet Anteile A-D und die A+B-Quote nur aus bewerteten Stroemen", () => {
    const q = qualitaetsDaten([f1, f2, o1, strom({ id: "u", qualitaet: null })]);
    expect(q.segmente.map((s) => s.stufe)).toEqual(["A", "B", "C", "D"]);
    expect(q.segmente[0]!.anteil).toBeCloseTo(2 / 3);
    expect(q.abProzent).toBe(100);
    expect(q.zeilen.find((z) => z.stufe === "A")).toMatchObject({ anzahl: 2, pct: 67 });
    expect(q.zeilen.find((z) => z.stufe === "C")).toMatchObject({ anzahl: 0, pct: 0 });
  });
});

describe("statusZeilen", () => {
  it("liefert die feste Reihenfolge mit Anzahl und Prozent", () => {
    const s = statusZeilen(alle);
    expect(s.map((z) => z.key)).toEqual(["entwurf", "in_pruefung", "geprueft", "verworfen"]);
    expect(s[2]).toMatchObject({ anzahl: 1, pct: 33 });
    expect(s[3]!.anzahl).toBe(0);
  });
});

describe("saisonDaten", () => {
  it("gewichtet das Angebot nach t atro; fehlende Saisonalitaet zaehlt flach 100", () => {
    const s = saisonDaten([f1, f2]);
    // Januar: (100*110 + 50*100) / 150 = 106.66 -> 107
    expect(s.feed![0]).toBe(107);
    expect(s.outEnergie).toBeNull();
    expect(s.outStofflich).toBeNull();
  });

  it("gewichtet Energie nach kWh der Targets und Stoffliches nach t (CO2 + Asche)", () => {
    // Targets: o1 500 MWh flach, e2 500 MWh mit Oktober-Spitze -> Mittel 110
    const e2 = strom({
      id: "e2",
      art: "output",
      gruppe: "primaerprodukte",
      produktCode: "strom",
      kategorie: "target",
      mengeWert: 500,
      mengeEinheit: "MWh/a",
      saisonalitaet: [100, 100, 100, 100, 100, 100, 100, 100, 100, 120, 100, 100],
    });
    const co2 = strom({
      id: "sco2",
      art: "output",
      gruppe: "add_ons",
      produktCode: "co2",
      kategorie: "add_on",
      mengeWert: 800,
      mengeEinheit: "t/a",
      saisonalitaet: [80, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 120],
    });
    const s = saisonDaten([o1, e2, co2]);
    expect(s.outEnergie![9]).toBe(110);
    expect(s.outStofflich![0]).toBe(80);
    // Waerme zaehlt nicht in die Energie-Saisonalitaet (nur Targets)
    const waerme = strom({
      id: "sw",
      art: "output",
      gruppe: "add_ons",
      produktCode: "waerme",
      kategorie: "add_on",
      mengeWert: 5800,
      mengeEinheit: "MWh/a",
      saisonalitaet: [200, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0],
    });
    expect(saisonDaten([o1, waerme]).outEnergie![0]).toBe(100);
  });
});

describe("belegtypZeilen", () => {
  it("zaehlt je Belegtyp mit pct relativ zum Maximum", () => {
    const z = belegtypZeilen(alle);
    const vertrag = z.find((b) => b.key === "vertrag")!;
    expect(vertrag).toMatchObject({ anzahl: 1, pct: 100, label: "Vertrag" });
    expect(z.find((b) => b.key === "betriebsdaten")!.anzahl).toBe(0);
  });
});

describe("jahresBalken", () => {
  // Dynamische Achse (E16, Eric 21.09.): die Jahre kommen aus den
  // Belegzeitraeumen, lueckenlos vom fruehesten bis zum spaetesten Jahr.
  // Semantik bleibt die JAHRESRATE (t atro/a): ein Beleg zaehlt in jedem
  // Kalenderjahr seines Zeitraums mit seiner vollen Rate.
  it("spannt die Achse dynamisch ueber die Belegzeitraeume", () => {
    // f1: 2027-2029, f2: 2026-2031 -> Achse 2026..2031
    const j = jahresBalken([f1, f2], 2026);
    expect(j.map((b) => b.jahr)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(j[0]).toMatchObject({ wertText: "50", aktuell: true });
    expect(j[1]!.wertText).toBe("150");
    expect(j[4]!.wertText).toBe("50");
    expect(j[1]!.pct).toBe(100);
  });

  it("zeigt vergangene Zeitraeume und grenzt sie als Vergangenheit ab", () => {
    const alt = strom({
      id: "alt",
      mengeAtro: 1200,
      zeitraumVon: "2024-01-01",
      zeitraumBis: "2025-12-31",
    });
    const neu = strom({
      id: "neu",
      mengeAtro: 600,
      zeitraumVon: "2026-01-01",
      zeitraumBis: "2026-12-31",
    });
    const j = jahresBalken([alt, neu], 2026);
    expect(j.map((b) => [b.jahr, b.wertText, b.vergangen])).toEqual([
      [2024, "1.200", true],
      [2025, "1.200", true],
      [2026, "600", false],
    ]);
    expect(j[2]!.aktuell).toBe(true);
  });

  it("faellt ohne jeden Zeitraum auf das aktuelle Jahr zurueck", () => {
    const offen = strom({ id: "f9", mengeAtro: 5, zeitraumVon: null, zeitraumBis: null });
    const j = jahresBalken([offen], 2026);
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([[2026, "5"]]);
  });

  it("zaehlt offene Zeitraeume ueber die ganze Achse durch", () => {
    const offen = strom({ id: "f9", mengeAtro: 5, zeitraumVon: null, zeitraumBis: null });
    const fix = strom({ id: "fx", mengeAtro: 10, zeitraumVon: "2026-01-01", zeitraumBis: "2027-12-31" });
    const j = jahresBalken([offen, fix], 2026);
    expect(j.map((b) => b.wertText)).toEqual(["15", "15"]);
  });

  it("zaehlt einen Jahreswechsel-Beleg in beiden Grenzjahren, nicht darueber hinaus", () => {
    const wechsel = strom({
      id: "jw",
      mengeAtro: 2,
      zeitraumVon: "2026-12-31",
      zeitraumBis: "2027-01-01",
    });
    const j = jahresBalken([wechsel], 2026);
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "2"],
      [2027, "2"],
    ]);
  });

  it("ordnet ein Teiljahr genau seinem Kalenderjahr zu, ohne Nachbarjahre", () => {
    const teil = strom({
      id: "tj",
      mengeAtro: 600,
      zeitraumVon: "2027-07-01",
      zeitraumBis: "2027-12-31",
    });
    const j = jahresBalken([teil], 2026);
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([[2027, "600"]]);
  });

  it("haelt ein Jahr ohne Belege als 0-Balken in der durchgaengigen Achse", () => {
    const a = strom({ id: "l1", mengeAtro: 100, zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31" });
    const b = strom({ id: "l2", mengeAtro: 50, zeitraumVon: "2028-01-01", zeitraumBis: "2028-12-31" });
    const j = jahresBalken([a, b], 2026);
    expect(j.map((x) => [x.jahr, x.wertText])).toEqual([
      [2026, "100"],
      [2027, "0"],
      [2028, "50"],
    ]);
  });

  it("summiert ueberlappende Belege je Jahr als Summe der Raten", () => {
    const a = strom({ id: "u1", mengeAtro: 1200, zeitraumVon: "2026-01-01", zeitraumBis: "2027-12-31" });
    const b = strom({ id: "u2", mengeAtro: 900, zeitraumVon: "2027-01-01", zeitraumBis: "2029-12-31" });
    const j = jahresBalken([a, b], 2026);
    expect(j.map((x) => [x.jahr, x.wertText])).toEqual([
      [2026, "1.200"],
      [2027, "2.100"],
      [2028, "900"],
      [2029, "900"],
    ]);
  });
});

describe("saldoZeilen", () => {
  it("spannt je Cluster Min/Mittel/Max von Preis × t atro auf einer 0..Max-Skala auf", () => {
    const z = saldoZeilen([f1, f2], [f1, f2]);
    expect(z.map((r) => r.key)).toEqual([
      "organische_rest_abfallstoffe",
      "lignozellulosische_reststoffe",
    ]);
    // f1: 500 / 1.000 / 2.000 — f2: 400 / 800 / 1.200; Skala 0..2.000
    expect(z[0]).toMatchObject({
      minText: "500",
      mittelText: "1.000",
      maxText: "2.000",
      vonPct: 25,
      mittelPct: 50,
      bisPct: 100,
      leer: false,
    });
    expect(z[1]).toMatchObject({ vonPct: 20, mittelPct: 40, bisPct: 60 });
  });

  it("faellt ohne Min/Max auf preisMittel zurueck und markiert Cluster ohne Preis als leer", () => {
    const nurMittel = strom({
      id: "m",
      cluster: "nachwachsende_rohstoffe",
      mengeAtro: 10,
      preisMittel: 5,
    });
    const ohne = strom({ id: "o", cluster: "lipide_spezialfeedstocks", mengeAtro: 10 });
    const z = saldoZeilen([nurMittel, ohne], [nurMittel, ohne]);
    expect(z[0]).toMatchObject({ minText: "50", maxText: "50", leer: false });
    expect(z[1]!.leer).toBe(true);
  });

  it("liefert je Materialart eine Unterzeile auf derselben Skala", () => {
    const z = saldoZeilen([f1, f2], [f1, f2]);
    expect(z[0]!.unter).toHaveLength(1);
    expect(z[0]!.unter[0]).toMatchObject({
      label: "Gülle",
      minText: "500",
      mittelText: "1.000",
      maxText: "2.000",
      vonPct: 25,
      mittelPct: 50,
      bisPct: 100,
      leer: false,
    });
    expect(z[1]!.unter[0]!.label).toBe("ohne Materialart");
  });

  it("markiert Materialarten ohne Preis als leer und sortiert sie ans Ende", () => {
    const mitPreis = strom({
      id: "mp",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "guelle",
      materialartLabel: "Gülle",
      mengeAtro: 10,
      preisMittel: 5,
    });
    const ohnePreis = strom({
      id: "op",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "biotonne",
      materialartLabel: "Biotonne",
      mengeAtro: 99,
    });
    const z = saldoZeilen([mitPreis, ohnePreis], [mitPreis, ohnePreis]);
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Gülle", "Biotonne"]);
    expect(z[0]!.unter[1]!.leer).toBe(true);
  });

  it("haelt gefilterte Materialarten als leere Unterzeilen sichtbar", () => {
    const g1 = strom({
      id: "g1",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "guelle",
      materialartLabel: "Gülle",
      mengeAtro: 10,
      preisMittel: 5,
    });
    const g2 = strom({
      id: "g2",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "biotonne",
      materialartLabel: "Biotonne",
      mengeAtro: 10,
      preisMittel: 5,
    });
    const z = saldoZeilen([g1, g2], [g1]);
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Gülle", "Biotonne"]);
    expect(z[0]!.unter[1]!.leer).toBe(true);
  });

  it("spannt die Skala bei negativen Salden ueber 0 hinaus auf (E14)", () => {
    // orga: 500/1.000/2.000 — ligno (Annahme): -1.200/-800/-500; Skala -1.200..2.000
    const fN = strom({
      id: "fn",
      cluster: "lignozellulosische_reststoffe",
      mengeAtro: 100,
      preisMin: -12,
      preisMittel: -8,
      preisMax: -5,
    });
    const z = saldoZeilen([f1, fN], [f1, fN]);
    expect(z[0]).toMatchObject({ minText: "500", vonPct: 53, mittelPct: 69, bisPct: 100 });
    expect(z[1]).toMatchObject({
      minText: "-1.200",
      mittelText: "-800",
      maxText: "-500",
      vonPct: 0,
      mittelPct: 13,
      bisPct: 22,
    });
  });
});

describe("preisKorridorZeilen", () => {
  it("zeigt je Cluster den Preiskorridor mit atro-gewichtetem Mittel", () => {
    const z = preisKorridorZeilen([f1, f2], [f1, f2]);
    // f1: 5 / 10 / 20 — f2: 8 / 16 / 24; Skala 0..24
    expect(z[0]).toMatchObject({
      minText: "5",
      mittelText: "10",
      maxText: "20",
      vonPct: 21,
      mittelPct: 42,
      bisPct: 83,
    });
    expect(z[1]).toMatchObject({ vonPct: 33, mittelPct: 67, bisPct: 100 });
  });

  it("mittelt Min/Mittel/Max je Position mengengewichtet (E14)", () => {
    const a = strom({
      id: "a",
      cluster: "lipide_spezialfeedstocks",
      mengeAtro: 100,
      preisMin: 4,
      preisMittel: 10,
      preisMax: 20,
    });
    const b = strom({
      id: "b",
      cluster: "lipide_spezialfeedstocks",
      mengeAtro: 50,
      preisMin: 10,
      preisMittel: 16,
      preisMax: 26,
    });
    const z = preisKorridorZeilen([a, b], [a, b]);
    // ø_min = (4*100+10*50)/150 = 6; ø = 12; ø_max = (20*100+26*50)/150 = 22
    expect(z[0]).toMatchObject({ minText: "6", mittelText: "12", maxText: "22" });
  });
});

// Gemeinsame Output-Fixtures fuer die Modul-Funktionen.
const oStrom = strom({
  id: "ostrom",
  art: "output",
  gruppe: "primaerprodukte",
  produktCode: "strom",
  produktLabel: "Strom",
  kategorie: "target",
  mengeWert: 500,
  mengeEinheit: "MWh/a",
  preis: 120,
  preisEinheit: "€/MWh",
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2027-12-31",
});
const oSyn = strom({
  id: "osyn",
  art: "output",
  gruppe: "primaerprodukte",
  produktCode: "synthesegas",
  produktLabel: "Synthesegas",
  kategorie: "target",
  mengeWert: 10,
  mengeEinheit: "t/a",
});
const oWaerme = strom({
  id: "owaerme",
  art: "output",
  gruppe: "add_ons",
  produktCode: "waerme",
  produktLabel: "Wärme",
  kategorie: "add_on",
  mengeWert: 5800,
  mengeEinheit: "MWh/a",
  preis: 80,
  preisEinheit: "€/MWh",
});
const oCo2 = strom({
  id: "oco2p",
  art: "output",
  gruppe: "add_ons",
  produktCode: "co2",
  produktLabel: "CO2",
  kategorie: "add_on",
  mengeWert: 800,
  mengeEinheit: "t/a",
  preis: 80,
  preisEinheit: "€/t",
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2026-12-31",
});
const oAsche = strom({
  id: "oasche",
  art: "output",
  gruppe: "add_ons",
  produktCode: "asche",
  produktLabel: "Asche",
  kategorie: "add_on",
  mengeWert: 240,
  mengeEinheit: "t/a",
});
const outputsAlle = [o1, oStrom, oSyn, oWaerme, oCo2, oAsche];

describe("outputMengen", () => {
  it("trennt energetische Zeilen (MWh/a) von stofflichen (t/a) mit Produkt-Unterzeilen", () => {
    const m = outputMengen(outputsAlle, outputsAlle);
    // Energetisch: Primaerprodukte 500+36,9 = 537, Wasserstoff 500, Waerme 5.800
    expect(m.energetisch.map((z) => z.key)).toEqual([
      "primaerprodukte",
      "wasserstoff",
      "waerme",
    ]);
    expect(m.energetisch[0]).toMatchObject({
      facette: "gruppe",
      wertText: "537",
      meta: "2 Belege",
    });
    expect(m.energetisch[2]).toMatchObject({
      facette: "produkt",
      wertText: "5.800",
      pct: 100,
    });
    expect(m.energetisch[0]!.unter.map((u) => u.label)).toEqual(["Strom", "Synthesegas"]);
    expect(m.energetisch[0]!.unter[1]!.wertText).toBe("37");
    // Stofflich: CO2 800, Asche 240
    expect(m.stofflich.map((z) => z.key)).toEqual(["co2", "asche"]);
    expect(m.stofflich[0]).toMatchObject({ facette: "produkt", wertText: "800", pct: 100 });
    expect(m.stofflich[1]!.pct).toBe(30);
  });

  it("haelt Zeilen aus dem Pool sichtbar, wenn der Filter sie leert", () => {
    const m = outputMengen(outputsAlle, [oCo2]);
    expect(m.energetisch[0]!.wertText).toBe("0");
    expect(m.stofflich[1]!.wertText).toBe("0");
  });
});

describe("outputJahre", () => {
  it("summiert Target-MWh (ohne Waerme) und stoffliche t auf gemeinsamer dynamischer Achse", () => {
    // oStrom 2026-2027, oCo2 2026, oWaerme offen -> Achse 2026..2027
    const j = outputJahre([oStrom, oWaerme, oCo2], 2026);
    expect(j.energie.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "500"],
      [2027, "500"],
    ]);
    expect(j.energie[0]!.aktuell).toBe(true);
    expect(j.stofflich.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "800"],
      [2027, "0"],
    ]);
  });
});

describe("outputPotenzialZeilen", () => {
  it("rechnet Preis x Menge je Zeile in €/a auf gemeinsamer Skala", () => {
    const z = outputPotenzialZeilen(outputsAlle, outputsAlle);
    // o1: 500 MWh * 8 €/MWh = 4.000; Strom 500*120 = 60.000; Waerme 464.000;
    // CO2 64.000; Syn/Asche ohne Preis
    const je = Object.fromEntries(z.map((r) => [r.key, r]));
    expect(je.waerme).toMatchObject({ wertText: "464.000", pct: 100 });
    expect(je.primaerprodukte!.wertText).toBe("60.000");
    expect(je.primaerprodukte!.meta).toContain("1 Beleg ohne Preis");
    expect(je.co2!.wertText).toBe("64.000");
    expect(je.asche!.wertText).toBe("–");
    expect(je.wasserstoff!.wertText).toBe("4.000");
  });
});

describe("outputPreisZeilen", () => {
  it("mittelt energetische Preise kWh-gewichtet in ct/kWh und stoffliche in €/kg", () => {
    const p = outputPreisZeilen(outputsAlle, outputsAlle);
    const je = Object.fromEntries(p.energetisch.map((r) => [r.key, r]));
    // Primaerprodukte: nur Strom mit Preis -> 12 ct/kWh; Waerme 8; o1 0,8
    expect(je.primaerprodukte!.wertText).toBe("12");
    expect(je.waerme!.wertText).toBe("8");
    expect(je.wasserstoff!.wertText).toBe("0,80");
    expect(p.stofflich[0]).toMatchObject({ key: "co2", wertText: "0,08" });
    expect(p.stofflich[1]).toMatchObject({ key: "asche", wertText: "–" });
  });
});

describe("verifZeilen", () => {
  it("sortiert nach Faelligkeit, markiert Ueberfaelliges und liefert hoechstens drei", () => {
    const z = verifZeilen(alle, "2026-11-01");
    // o1: gueltigBis 2026-10-01 (ueberfaellig), f2: gespraech +6M = 2027-02-01, f1: vertrag +36M = 2029-03-10
    expect(z.map((v) => v.id)).toEqual(["o1", "f2", "f1"]);
    expect(z[0]).toMatchObject({ ueberfaellig: true, datum: "01.10.2026" });
    expect(z[0]!.sub).toBe("Wasserstoff · Angebot");
    expect(z[1]!.ueberfaellig).toBe(false);
    expect(verifZeilen([f1, f2, o1, f1, f2], "2026-11-01")).toHaveLength(3);
  });

  it("ueberspringt Stroeme ohne berechenbare Frist", () => {
    expect(verifZeilen([strom({ id: "ohne" })], "2026-11-01")).toEqual([]);
  });
});
