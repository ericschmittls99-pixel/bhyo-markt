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
  potenzialZeilen,
  qualitaetsDaten,
  saisonDaten,
  statusZeilen,
  verifZeilen,
} from "./auswertung-modell";
import type { Strom, StromBeleg } from "./stroeme-modell";

const beleg = (patch: Partial<StromBeleg>): StromBeleg => ({
  id: "00000000-0000-4000-8000-000000000000",
  nr: null,
      typ: "vertrag",
  quellenangabe: null,
  href: null,
  externNachvollziehbar: false,
  gueltigBis: null,
  erhebungsdatum: null,
  // AP2.3: Startwert der Typ-Frist (Gespraech 3) — im Loader aus parameter_wert().
  fristMonate: 3,
  kernnotiz: null,
  ...patch,
});

const strom = (patch: Partial<Strom>): Strom => ({
  id: "x",
  art: "biomasse",
  akteurId: "a",
  akteurName: "A",
  sektorLabel: null,
  sektor: null,
  bezeichnung: null,
  kontaktperson: null,
  ort: null,
  verwaltung: null,
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
  reserviertBhyo: false,
  reserviertSeit: null,
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
  it("liefert Pruefquote, Trockenmasse, EINEN ø-Preis und Feedstock-Potenzial (E18)", () => {
    const k = kpiKarten([f1, f2], "feedstock");
    expect(k).toHaveLength(4);
    expect(k[0]).toMatchObject({ wert: "50", einheit: "%", label: "belege geprüft." });
    expect(k[1]).toMatchObject({ wert: "150", einheit: "t atro/a", label: "trockenmasse." });
    // Ein signierter ø ueber alle Belege: (10*100 + 16*50) / 150 = 12
    expect(k[2]).toMatchObject({ wert: "12", einheit: "€/t", label: "ø preis." });
    expect(k[2]!.caption).toBe("atro-gewichtet");
    // Potenzial = -Σ(preis*menge): nur Einkaeufe -> negativ (Nettokosten)
    expect(k[3]).toMatchObject({ wert: "-1.800", einheit: "€/a", label: "feedstock-potenzial." });
    expect(k[3]!.caption).toBe("");
  });

  it("macht Annahmeentgelte zu positivem Potenzial (E18)", () => {
    // fN: bhyo ERHAELT 8 €/t (negativ im Beleg), 100 t atro
    const fN = strom({
      id: "fn",
      cluster: "lignozellulosische_reststoffe",
      mengeAtro: 100,
      preisMin: -12,
      preisMittel: -8,
      preisMax: -5,
    });
    // Gemischter ø: (10*100 - 8*100) / 200 = 1
    const k = kpiKarten([f1, fN], "feedstock");
    expect(k[2]).toMatchObject({ wert: "1", einheit: "€/t" });
    // Saldo 200 (Kosten) -> Potenzial -200
    expect(k[3]).toMatchObject({ wert: "-200", einheit: "€/a" });
    // Nur der Annahme-Beleg: Erloes 800 -> Potenzial +800
    expect(kpiKarten([fN], "feedstock")[3]).toMatchObject({ wert: "800", einheit: "€/a" });
    expect(kpiKarten([fN], "feedstock")[2]!.wert).toBe("-8");
  });

  it("weist Belege ohne Preis aus statt sie still zu ignorieren", () => {
    const ohnePreis = strom({ id: "n", cluster: "lipide_spezialfeedstocks", mengeAtro: 10 });
    const k = kpiKarten([f1, ohnePreis], "feedstock");
    expect(k[2]!.caption).toBe("atro-gewichtet");
    expect(k[3]).toMatchObject({ wert: "-1.000", einheit: "€/a" });
  });

  it("zeigt ohne jeden Preis einen Strich statt 0", () => {
    const k = kpiKarten([strom({ id: "n", mengeAtro: 10 })], "feedstock");
    expect(k[2]).toMatchObject({ wert: "–", caption: "keine Preise in der Auswahl" });
    expect(k[3]!.wert).toBe("–");
  });

  it("skaliert grosse Potenziale vorzeichenerhaltend auf Mio. €/a", () => {
    const gross = strom({ id: "g", mengeAtro: 100000, preisMittel: 25 });
    expect(kpiKarten([gross], "feedstock")[3]).toMatchObject({
      wert: "-2,5",
      einheit: "Mio. €/a",
    });
    const grossNegativ = strom({ id: "gn", mengeAtro: 100000, preisMittel: -25 });
    expect(kpiKarten([grossNegativ], "feedstock")[3]).toMatchObject({
      wert: "2,5",
      einheit: "Mio. €/a",
    });
  });

  it("liefert bei sicht=outputs Pruefquote, Energiebedarf, €/MWh-Preis und Potenzial", () => {
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
    expect(k[1]!.caption).toBe("dazu 800 t CO₂/a");
    // MWh-gewichtet NUR ueber Target-Outputs (ohne Waerme), E20 in €/MWh:
    // (8*500 + 150,035*3.999,07) / 4.499,07 = 134,25 -> ganzzahlig 134
    expect(k[2]).toMatchObject({ wert: "134", einheit: "€/MWh", label: "ø preis." });
    expect(k[2]!.caption).toContain("Target-Outputs");
    // Potenzial: 500*8 + 600.000 + 5.800*80 + 800*80 = 1.132.000 -> 1,1 Mio (E20: eine Nachkommastelle)
    expect(k[3]).toMatchObject({ wert: "1,1", einheit: "Mio. €/a", label: "erlöspotenzial." });
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
  it("summiert t atro je Cluster, pct = ANTEIL an der Kachelsumme (E26), Farbe + Orb", () => {
    const z = clusterZeilen([f1, f2], [f1, f2], "feedstock").zeilen;
    expect(z.map((r) => r.key)).toEqual([
      "organische_rest_abfallstoffe",
      "lignozellulosische_reststoffe",
    ]);
    expect(z[0]).toMatchObject({
      wertText: "67 % · 100",
      pct: 67,
      farbe: "#5C8615",
      orb: "/orbs/cluster/organische_rest_abfallstoffe.webp",
    });
    expect(z[0]!.meta).toBe("1 Beleg");
    expect(z[1]!.pct).toBe(33);
  });

  it("haelt Zeilen aus dem Pool sichtbar, auch wenn der Filter sie leert", () => {
    const z = clusterZeilen([f1, f2], [f1], "feedstock").zeilen;
    expect(z).toHaveLength(2);
    expect(z[1]!.wertText).toBe("0 % · 0");
    expect(z[1]!.null0).toBe(true);
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
    const z = clusterZeilen([g1, g2], [g1, g2], "feedstock").zeilen;
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Biotonne", "Gülle"]);
    // Gleiche Spur und Skala wie die Elternzeilen: Anteil an der
    // Kachelsumme (400 t atro) — 300/400 = 75 %.
    expect(z[0]!.unter[0]).toMatchObject({
      key: "biotonne",
      wertText: "75 % · 300",
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
    const z = clusterZeilen([g1, g2], [g1], "feedstock").zeilen;
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Gülle", "Biotonne"]);
    expect(z[0]!.unter[1]).toMatchObject({
      wertText: "0 % · 0",
      pct: 0,
      meta: "0 Belege",
      null0: true,
    });
  });

  it("fasst Belege ohne Materialart-Code als nicht filterbare Unterzeile", () => {
    // f1 traegt nur ein Label (kein Code), f2 gar keine Materialart
    const z = clusterZeilen([f1, f2], [f1, f2], "feedstock").zeilen;
    expect(z[0]!.unter[0]).toMatchObject({ key: "", label: "Gülle" });
    expect(z[1]!.unter[0]).toMatchObject({ key: "", label: "ohne Materialart" });
  });

  it("zaehlt bei sicht=outputs Belege je Gruppe ohne Unterzeilen; add_ons nutzt den waerme-Orb", () => {
    const addOn = strom({ id: "o2", art: "output", gruppe: "add_ons", mengeWert: 10, mengeEinheit: "t/a" });
    const z = clusterZeilen([o1, addOn], [o1, addOn], "outputs").zeilen;
    expect(z.map((r) => r.key)).toEqual(["wasserstoff", "add_ons"]);
    expect(z[0]).toMatchObject({ wertText: "50 % · 1 Beleg", meta: "500 MWh/a" });
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

  // E24: unbelegte Stroeme fallen nicht mehr stumm raus.
  it("zeigt unbelegte als eigene Zeile (pct auf alle), Donut bleibt A-D", () => {
    const q = qualitaetsDaten([f1, f2, o1, strom({ id: "u", qualitaet: null })]);
    expect(q.segmente.map((s) => s.stufe)).toEqual(["A", "B", "C", "D"]);
    expect(q.zeilen.find((z) => z.stufe === "unbelegt")).toMatchObject({ anzahl: 1, pct: 25 });
  });

  it("ohne unbelegte Stroeme gibt es keine unbelegt-Zeile", () => {
    const q = qualitaetsDaten([f1, f2, o1]);
    expect(q.zeilen.some((z) => z.stufe === "unbelegt")).toBe(false);
  });
});

describe("statusZeilen", () => {
  it("liefert die feste Reihenfolge mit Anzahl und Prozent", () => {
    const s = statusZeilen(alle).zeilen;
    expect(s.map((z) => z.key)).toEqual(["entwurf", "in_pruefung", "geprueft", "verworfen"]);
    expect(s[2]).toMatchObject({ anzahl: 1, pct: 33 });
    expect(statusZeilen(alle).basisText).toBe("3 Ströme der Auswahl");
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
    // Index-Konvention (23.09.2026): Profile werden vor dem Mischen aufs
    // Mittel 100 normiert — e2 (Summe 1220) traegt im Oktober 118 statt
    // roher 120, gewichtet ergibt das 109.
    expect(s.outEnergie![9]).toBe(109);
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
  it("zaehlt je Belegtyp mit pct = ANTEIL an der Kachelsumme (E26)", () => {
    const liste = belegtypZeilen(alle);
    const z = liste.zeilen;
    const vertrag = z.find((b) => b.key === "vertrag")!;
    expect(vertrag).toMatchObject({ anzahl: 1, label: "Vertrag" });
    expect(liste.basisText).toContain("Anteil an");
    const leer = z.find((b) => b.key === "betriebsdaten")!;
    expect(leer.anzahl).toBe(0);
    expect(leer.null0).toBe(true);
  });
});

describe("jahresBalken", () => {
  // Dynamische Achse (E16, Eric 21.09.): die Jahre kommen aus den
  // Belegzeitraeumen, lueckenlos vom fruehesten bis zum spaetesten Jahr.
  // Seit E19 (AP1j PR 4) MONATSSCHARF: ein Beleg zaehlt je Jahr mit
  // Rate × Σ Saisonanteile der zaehlenden Monate — Teiljahre nicht mehr voll.
  it("spannt die Achse dynamisch ueber die Belegzeitraeume", () => {
    // f1: 2027-2029, f2: 2026-2031 -> Achse 2026..2031
    const j = jahresBalken([f1, f2], 2026).balken;
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
    const j = jahresBalken([alt, neu], 2026).balken;
    expect(j.map((b) => [b.jahr, b.wertText, b.vergangen])).toEqual([
      [2024, "1.200", true],
      [2025, "1.200", true],
      [2026, "600", false],
    ]);
    expect(j[2]!.aktuell).toBe(true);
  });

  it("Beleg ohne Zeitraum traegt nichts bei (E19: kein Raten), Achse faellt aufs aktuelle Jahr", () => {
    const offen = strom({ id: "f9", mengeAtro: 5, zeitraumVon: null, zeitraumBis: null });
    const j = jahresBalken([offen], 2026).balken;
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([[2026, "0"]]);
  });

  it("Beleg ohne Zeitraum aendert die Werte anderer Belege nicht", () => {
    const offen = strom({ id: "f9", mengeAtro: 5, zeitraumVon: null, zeitraumBis: null });
    const fix = strom({ id: "fx", mengeAtro: 10, zeitraumVon: "2026-01-01", zeitraumBis: "2027-12-31" });
    const j = jahresBalken([offen, fix], 2026).balken;
    expect(j.map((b) => b.wertText)).toEqual(["10", "10"]);
  });

  it("zaehlt einen Jahreswechsel-Beleg monatsscharf: je 1/12 der Rate in den Grenzjahren", () => {
    const wechsel = strom({
      id: "jw",
      mengeAtro: 24,
      zeitraumVon: "2026-12-31",
      zeitraumBis: "2027-01-01",
    });
    const j = jahresBalken([wechsel], 2026).balken;
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "2"],
      [2027, "2"],
    ]);
  });

  it("Teiljahr zaehlt monatsscharf (E19): Jul-Dez = 6/12 der Rate", () => {
    const teil = strom({
      id: "tj",
      mengeAtro: 600,
      zeitraumVon: "2027-07-01",
      zeitraumBis: "2027-12-31",
    });
    const j = jahresBalken([teil], 2026).balken;
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([[2027, "300"]]);
  });

  it("E16-Deckel: Beleg bis 2099 -> Achse endet bei aktuellem Jahr + 10, Ueberlauf-Marker", () => {
    const s = strom({
      id: "x99",
      mengeAtro: 120,
      zeitraumVon: "2026-01-01",
      zeitraumBis: "2099-12-31",
    });
    const j = jahresBalken([s], 2026).balken;
    expect(j[j.length - 1]!.jahr).toBe(2036);
    expect(j[j.length - 1]!.ueberlaufBis).toBe(2099);
    expect(j[0]!.ueberlaufBis).toBeNull();
  });

  it("monatsscharf mit Kategorien: vergebene Monate zaehlen nicht zur freien Menge", () => {
    const s = strom({
      id: "vk",
      mengeAtro: 120,
      zeitraumVon: "2026-01-01",
      zeitraumBis: "2028-12-31",
    });
    const map = new Map([
      ["vk", [{ vergebenVon: null, vergebenBis: "2028-06-30", vergebenAn: null, anBhyo: false }]],
    ]);
    const j = jahresBalken([s], 2026, map, new Set(["verfuegbar"] as const)).balken;
    expect(j.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "0"],
      [2027, "0"],
      [2028, "60"],
    ]);
  });

  it("haelt ein Jahr ohne Belege als 0-Balken in der durchgaengigen Achse", () => {
    const a = strom({ id: "l1", mengeAtro: 100, zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31" });
    const b = strom({ id: "l2", mengeAtro: 50, zeitraumVon: "2028-01-01", zeitraumBis: "2028-12-31" });
    const j = jahresBalken([a, b], 2026).balken;
    expect(j.map((x) => [x.jahr, x.wertText])).toEqual([
      [2026, "100"],
      [2027, "0"],
      [2028, "50"],
    ]);
  });

  it("summiert ueberlappende Belege je Jahr als Summe der Raten", () => {
    const a = strom({ id: "u1", mengeAtro: 1200, zeitraumVon: "2026-01-01", zeitraumBis: "2027-12-31" });
    const b = strom({ id: "u2", mengeAtro: 900, zeitraumVon: "2027-01-01", zeitraumBis: "2029-12-31" });
    const j = jahresBalken([a, b], 2026).balken;
    expect(j.map((x) => [x.jahr, x.wertText])).toEqual([
      [2026, "1.200"],
      [2027, "2.100"],
      [2028, "900"],
      [2029, "900"],
    ]);
  });
});

describe("potenzialZeilen", () => {
  it("flippt den Saldo je Cluster zum Potenzial: Einkaeufe sind negativ (E18)", () => {
    const z = potenzialZeilen([f1, f2], [f1, f2]);
    expect(z.map((r) => r.key)).toEqual([
      "organische_rest_abfallstoffe",
      "lignozellulosische_reststoffe",
    ]);
    // Salden f1: 500/1.000/2.000, f2: 400/800/1.200 -> Potenziale
    // f1: -2.000/-1.000/-500, f2: -1.200/-800/-400; gemeinsame Skala
    // exakt vom kleinsten Min bis zum groessten Max: -2.000..-400
    expect(z[0]).toMatchObject({
      minText: "-2.000",
      mittelText: "-1.000",
      maxText: "-500",
      vonPct: 0,
      mittelPct: 63,
      bisPct: 94,
      leer: false,
    });
    expect(z[1]).toMatchObject({ vonPct: 50, mittelPct: 75, bisPct: 100 });
  });

  it("faellt ohne Min/Max auf preisMittel zurueck und markiert Cluster ohne Preis als leer", () => {
    const nurMittel = strom({
      id: "m",
      cluster: "nachwachsende_rohstoffe",
      mengeAtro: 10,
      preisMittel: 5,
    });
    const ohne = strom({ id: "o", cluster: "lipide_spezialfeedstocks", mengeAtro: 10 });
    const z = potenzialZeilen([nurMittel, ohne], [nurMittel, ohne]);
    expect(z[0]).toMatchObject({ minText: "-50", maxText: "-50", leer: false });
    expect(z[1]!.leer).toBe(true);
  });

  it("liefert je Materialart eine Unterzeile auf derselben Skala", () => {
    const z = potenzialZeilen([f1, f2], [f1, f2]);
    expect(z[0]!.unter).toHaveLength(1);
    expect(z[0]!.unter[0]).toMatchObject({
      label: "Gülle",
      minText: "-2.000",
      mittelText: "-1.000",
      maxText: "-500",
      vonPct: 0,
      mittelPct: 63,
      bisPct: 94,
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
    const z = potenzialZeilen([mitPreis, ohnePreis], [mitPreis, ohnePreis]);
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
    const z = potenzialZeilen([g1, g2], [g1]);
    expect(z[0]!.unter.map((u) => u.label)).toEqual(["Gülle", "Biotonne"]);
    expect(z[0]!.unter[1]!.leer).toBe(true);
  });

  it("spannt die Skala auch ueber Materialart-Spannen, die den Cluster ueberragen", () => {
    // Gemischtes Cluster: Guelle (Annahme) Potenzial +1.000/+2.000/+2.500,
    // Biotonne (Einkauf) -4.000/-3.000/-2.000; Cluster-Summe -3.000/-1.000/+500.
    // Die Skala muss alle Materialarten umfassen (-4.000..2.500), sonst
    // laufen Baender und oe-Punkt aus der Spur.
    const annahme = strom({
      id: "an",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "guelle",
      materialartLabel: "Gülle",
      mengeAtro: 100,
      preisMin: -25,
      preisMittel: -20,
      preisMax: -10,
    });
    const einkauf = strom({
      id: "ek",
      cluster: "organische_rest_abfallstoffe",
      materialartCode: "biotonne",
      materialartLabel: "Biotonne",
      mengeAtro: 100,
      preisMin: 20,
      preisMittel: 30,
      preisMax: 40,
    });
    const z = potenzialZeilen([annahme, einkauf], [annahme, einkauf]);
    expect(z[0]).toMatchObject({ vonPct: 15, mittelPct: 46, bisPct: 69 });
    expect(z[0]!.unter[0]).toMatchObject({
      label: "Gülle",
      vonPct: 77,
      mittelPct: 92,
      bisPct: 100,
    });
    expect(z[0]!.unter[1]).toMatchObject({
      label: "Biotonne",
      vonPct: 0,
      mittelPct: 15,
      bisPct: 31,
    });
  });

  it("macht Annahme-Cluster positiv und spannt die Skala ueber 0 (E18)", () => {
    // Potenziale: orga (Einkauf) -2.000/-1.000/-500 — ligno (Annahme)
    // +500/+800/+1.200; Skala -2.000..1.200
    const fN = strom({
      id: "fn",
      cluster: "lignozellulosische_reststoffe",
      mengeAtro: 100,
      preisMin: -12,
      preisMittel: -8,
      preisMax: -5,
    });
    const z = potenzialZeilen([f1, fN], [f1, fN]);
    expect(z[0]).toMatchObject({ minText: "-2.000", vonPct: 0, mittelPct: 31, bisPct: 47 });
    expect(z[1]).toMatchObject({
      minText: "500",
      mittelText: "800",
      maxText: "1.200",
      vonPct: 78,
      mittelPct: 88,
      bisPct: 100,
    });
  });
});

describe("preisKorridorZeilen", () => {
  it("zeigt je Cluster den Preiskorridor mit atro-gewichtetem Mittel", () => {
    const z = preisKorridorZeilen([f1, f2], [f1, f2]);
    // f1: 5 / 10 / 20 — f2: 8 / 16 / 24; gemeinsame Skala exakt 5..24
    expect(z[0]).toMatchObject({
      minText: "5",
      mittelText: "10",
      maxText: "20",
      vonPct: 0,
      mittelPct: 26,
      bisPct: 79,
    });
    expect(z[1]).toMatchObject({ vonPct: 16, mittelPct: 58, bisPct: 100 });
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

// Drei Faelle der ø-Preis-Basis (Eric, 22.09.2026): null = atro-Menge nicht
// ableitbar, 0 = im Bezugsjahr auf 0 skaliert — nie zusammenfassen.
describe("Rechenbasis ø-Preis: drei Faelle in Korridor UND KPI-Kachel", () => {
  const cluster = "organische_rest_abfallstoffe";

  it("Fall C: Gewichte auf 0 skaliert -> Menge 0 UND kein ø-Preis, konsistent", () => {
    // Wie Guelle/Mist auf der Preview: Belege ausserhalb des Bezugsjahres.
    const a = strom({ id: "a", cluster, mengeAtro: 0, preisMin: 5, preisMittel: 7, preisMax: 9 });
    const b = strom({ id: "b", cluster, mengeAtro: 0, preisMin: 2, preisMittel: 4, preisMax: 6 });
    const z = preisKorridorZeilen([a, b], [a, b]);
    expect(z[0]).toMatchObject({
      leer: true,
      mittelText: "–",
      hinweis: "2 Belege, keine Menge im Bezugsjahr",
    });
    const k = kpiKarten([a, b], "feedstock");
    expect(k[1]!.wert).toBe("0"); // Mengenmodul-Basis: Menge 0
    expect(k[2]).toMatchObject({ wert: "–", caption: "2 Belege, keine Menge im Bezugsjahr" });
  });

  it("Fall C auch im Mischfall null + 0: mindestens ein Gewicht vorhanden, alle 0", () => {
    const nullAtro = strom({ id: "n", cluster, mengeAtro: null, preisMittel: 99 });
    const nullJahr = strom({ id: "j", cluster, mengeAtro: 0, preisMittel: 7 });
    const z = preisKorridorZeilen([nullAtro, nullJahr], [nullAtro, nullJahr]);
    expect(z[0]).toMatchObject({ leer: true, hinweis: "2 Belege, keine Menge im Bezugsjahr" });
  });

  it("Fall B: alle Positionen ohne ableitbare atro-Menge -> ungewichtet, gekennzeichnet", () => {
    const a = strom({ id: "a", cluster, mengeAtro: null, preisMin: 5, preisMittel: 10, preisMax: 20 });
    const b = strom({ id: "b", cluster, mengeAtro: null, preisMin: 8, preisMittel: 16, preisMax: 24 });
    const z = preisKorridorZeilen([a, b], [a, b]);
    expect(z[0]).toMatchObject({
      mittelText: "13", // (10+16)/2, ungewichtet
      zusatz: "· ungewichtet",
      hinweis: "für diese Positionen ist keine atro-Menge ableitbar",
      leer: false,
    });
    const k = kpiKarten([a, b], "feedstock");
    expect(k[2]!.wert).toBe("13");
    expect(k[2]!.caption).toContain("ungewichtet");
  });

  it("Fall A gemischt: gewichtet nur ueber gewichtbare, ohne n-Anzeige (Review 22.09.)", () => {
    const gewichtet = strom({ id: "g", cluster, mengeAtro: 100, preisMittel: 10 });
    const ohneAtro = strom({ id: "o", cluster, mengeAtro: null, preisMittel: 99 });
    const z = preisKorridorZeilen([gewichtet, ohneAtro], [gewichtet, ohneAtro]);
    expect(z[0]).toMatchObject({ mittelText: "10", zusatz: null });
    const k = kpiKarten([gewichtet, ohneAtro], "feedstock");
    expect(k[2]!.wert).toBe("10");
    expect(k[2]!.caption).toBe("atro-gewichtet");
  });

  it("Fall A ohne Ausschluesse: keine n-Angabe, kein Kennzeichen", () => {
    const z = preisKorridorZeilen([f1], [f1]);
    expect(z[0]).toMatchObject({ mittelText: "10", zusatz: null, hinweis: null });
  });

  it("Kachel und Modul zeigen fuer denselben Datensatz denselben ø", () => {
    const a = strom({ id: "a", cluster, mengeAtro: 120, preisMittel: -64 });
    const b = strom({ id: "b", cluster, mengeAtro: 40, preisMittel: -30 });
    const c = strom({ id: "c", cluster, mengeAtro: null, preisMittel: 5 });
    const z = preisKorridorZeilen([a, b, c], [a, b, c]);
    const k = kpiKarten([a, b, c], "feedstock");
    expect(z[0]!.mittelText).toBe(k[2]!.wert);
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
    // E26: Anteil an der Summe der jeweiligen Liste — energetisch
    // 537+500+5.800 = 6.837 MWh, stofflich 800+240 = 1.040 t. Nie eine
    // gemeinsame Skala ueber beide Einheiten.
    expect(m.basisEnergetisch).toBe("Anteil an 6.837 MWh/a");
    expect(m.basisStofflich).toBe("Anteil an 1.040 t/a");
    expect(m.energetisch[0]).toMatchObject({
      facette: "gruppe",
      wertText: "8 % · 537",
      meta: "2 Belege",
    });
    expect(m.energetisch[2]).toMatchObject({
      facette: "produkt",
      wertText: "85 % · 5.800",
      pct: 85,
    });
    expect(m.energetisch[0]!.unter.map((u) => u.label)).toEqual(["Strom", "Synthesegas"]);
    expect(m.energetisch[0]!.unter[1]!.wertText).toBe("1 % · 37");
    // Stofflich: CO2 800, Asche 240 -> 77 % / 23 %
    expect(m.stofflich.map((z) => z.key)).toEqual(["co2", "asche"]);
    expect(m.stofflich[0]).toMatchObject({ facette: "produkt", wertText: "77 % · 800", pct: 77 });
    expect(m.stofflich[1]!.pct).toBe(23);
  });

  it("haelt Zeilen aus dem Pool sichtbar, wenn der Filter sie leert", () => {
    const m = outputMengen(outputsAlle, [oCo2]);
    expect(m.energetisch[0]!.wertText).toBe("0 % · 0");
    expect(m.energetisch[0]!.null0).toBe(true);
    expect(m.stofflich[1]!.wertText).toBe("0 % · 0");
  });
});

describe("outputJahre", () => {
  it("summiert Target-MWh (ohne Waerme) und stoffliche t auf gemeinsamer dynamischer Achse", () => {
    // oStrom 2026-2027, oCo2 2026, oWaerme offen -> Achse 2026..2027
    const j = outputJahre([oStrom, oWaerme, oCo2], 2026);
    expect(j.energie.balken.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "500"],
      [2027, "500"],
    ]);
    expect(j.energie.balken[0]!.aktuell).toBe(true);
    expect(j.stofflich.balken.map((b) => [b.jahr, b.wertText])).toEqual([
      [2026, "800"],
      [2027, "0"],
    ]);
  });
});

describe("outputPotenzialZeilen", () => {
  it("rechnet Preis x Menge je Zeile in €/a auf gemeinsamer Skala", () => {
    const z = outputPotenzialZeilen(outputsAlle, outputsAlle);
    // o1: 500 MWh * 8 €/MWh = 4.000; Strom 500*120 = 60.000; Waerme 464.000;
    // CO2 64.000; Syn/Asche ohne Preis. Zweigeteilt energetisch/stofflich
    // (Review 22.09.), gemeinsame Skala ueber beide Sektionen.
    expect(z.stofflich.map((r) => r.key)).toEqual(["co2", "asche"]);
    const je = Object.fromEntries([...z.energetisch, ...z.stofflich].map((r) => [r.key, r]));
    expect(je.waerme).toMatchObject({ wertText: "464.000", pct: 100 });
    expect(je.primaerprodukte!.wertText).toBe("60.000");
    expect(je.primaerprodukte!.meta).toContain("1 Beleg ohne Preis");
    expect(je.co2!.wertText).toBe("64.000");
    expect(je.asche!.wertText).toBe("–");
    expect(je.wasserstoff!.wertText).toBe("4.000");
  });
});

describe("outputPreisZeilen", () => {
  it("mittelt energetische Preise MWh-gewichtet in €/MWh und stoffliche in €/t (E20)", () => {
    const p = outputPreisZeilen(outputsAlle, outputsAlle);
    const je = Object.fromEntries(p.energetisch.map((r) => [r.key, r]));
    // Primaerprodukte: nur Strom mit Preis -> 120 €/MWh; Waerme 80; o1 8
    expect(je.primaerprodukte!.wertText).toBe("120");
    expect(je.waerme!.wertText).toBe("80");
    expect(je.wasserstoff!.wertText).toBe("8");
    expect(p.stofflich[0]).toMatchObject({ key: "co2", wertText: "80" });
    expect(p.stofflich[1]).toMatchObject({ key: "asche", wertText: "–" });
  });
});

// Dieselben drei Faelle wie auf der Feedstock-Seite (Eric, 22.09.2026),
// ueber dieselbe Hilfsfunktion: Gewicht = Energiemenge (kWh); null = nicht
// ableitbar, 0 = im Bezugsjahr auf 0 skaliert.
describe("Rechenbasis ø-Preis Outputs: drei Faelle in Kachel und preise-Modul", () => {
  const target = (patch: Partial<Strom>): Strom =>
    strom({
      art: "output",
      gruppe: "wasserstoff",
      produktCode: "h2_niederdruck",
      kategorie: "target",
      mengeEinheit: "MWh/a",
      preisEinheit: "€/MWh",
      ...patch,
    });

  it("Fall C: Energiemengen auf 0 skaliert -> kein ø, gedimmt gekennzeichnet", () => {
    const a = target({ id: "a", mengeWert: 0, preis: 80 });
    const b = target({ id: "b", mengeWert: 0, preis: 40 });
    const k = kpiKarten([a, b], "outputs");
    expect(k[2]).toMatchObject({ wert: "–", caption: "2 Belege, keine Menge im Bezugsjahr" });
    const h2 = outputPreisZeilen([a, b], [a, b]).energetisch.find((r) => r.key === "wasserstoff")!;
    expect(h2).toMatchObject({
      wertText: "–",
      hinweis: "2 Belege, keine Menge im Bezugsjahr",
      stumm: true,
    });
  });

  it("Fall B: keine Energiemenge ableitbar -> ungewichtet, sichtbar gekennzeichnet", () => {
    const a = target({ id: "a", mengeWert: null, preis: 80 }); // 80 €/MWh
    const b = target({ id: "b", mengeWert: null, preis: 40 }); // 40 €/MWh
    const k = kpiKarten([a, b], "outputs");
    expect(k[2]!.wert).toBe("60");
    expect(k[2]!.caption).toContain("ungewichtet");
    const h2 = outputPreisZeilen([a, b], [a, b]).energetisch.find((r) => r.key === "wasserstoff")!;
    expect(h2).toMatchObject({
      wertText: "60",
      zusatz: "· ungewichtet",
      hinweis: "für diese Positionen ist keine Energiemenge ableitbar",
    });
  });

  it("Fall A gemischt: gewichtet nur ueber Positionen mit Energiemenge, ohne n-Anzeige", () => {
    const mitMenge = target({ id: "m", mengeWert: 500, preis: 80 }); // 80 €/MWh, 500 MWh
    const ohneMenge = target({ id: "o", mengeWert: null, preis: 999 });
    const k = kpiKarten([mitMenge, ohneMenge], "outputs");
    expect(k[2]!.wert).toBe("80");
    expect(k[2]!.caption).toBe("MWh-gewichtet über Target-Outputs");
    const h2 = outputPreisZeilen([mitMenge, ohneMenge], [mitMenge, ohneMenge]).energetisch.find(
      (r) => r.key === "wasserstoff",
    )!;
    expect(h2).toMatchObject({ wertText: "80", zusatz: null });
  });

  it("Kachel und Modul zeigen fuer denselben Datensatz denselben ø", () => {
    const a = target({ id: "a", mengeWert: 1000, preis: 100 }); // 100 €/MWh
    const b = target({ id: "b", mengeWert: 500, preis: 40 }); // 40 €/MWh -> gewichtet 80
    const c = target({ id: "c", mengeWert: null, preis: 77 });
    const k = kpiKarten([a, b, c], "outputs");
    const h2 = outputPreisZeilen([a, b, c], [a, b, c]).energetisch.find(
      (r) => r.key === "wasserstoff",
    )!;
    expect(h2.wertText).toBe(k[2]!.wert);
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

// E26 (Eric, 23.09.2026): die drei Zusicherungen der Kachel-Skalen.
describe("E26 — Skalen und Bezugsgroessen", () => {
  it("Zusammensetzung: die Anteile einer Kachel ergeben 100 % (gerundet ±1)", () => {
    const summe = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
    const cluster = clusterZeilen([f1, f2, o1], [f1, f2, o1], "feedstock");
    expect(Math.abs(summe(cluster.zeilen.map((z) => z.pct)) - 100)).toBeLessThanOrEqual(1);
    const belegtypen = belegtypZeilen(alle);
    expect(Math.abs(summe(belegtypen.zeilen.map((z) => z.pct)) - 100)).toBeLessThanOrEqual(1);
    const mengen = outputMengen(outputsAlle, outputsAlle);
    expect(Math.abs(summe(mengen.energetisch.map((z) => z.pct)) - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(summe(mengen.stofflich.map((z) => z.pct)) - 100)).toBeLessThanOrEqual(1);
  });

  it("Zusammensetzung: leere Auswahl erzeugt kein 100-%-Phantom", () => {
    const leer = clusterZeilen([f1, f2], [], "feedstock");
    expect(leer.zeilen.every((z) => z.pct === 0 && z.null0)).toBe(true);
  });

  it("Zeitreihe: die Skala beginnt bei 0 und nennt ihre Obergrenze", () => {
    const j = jahresBalken([f1, f2], 2026);
    expect(j.skalaText).toMatch(/^0 bis /);
    expect(Math.min(...j.balken.map((b) => b.pct))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...j.balken.map((b) => b.pct))).toBe(100);
    // Ein Jahr ohne Menge zeigt keinen Stummel (Luecke 2027).
    const frueh = strom({ id: "j1", mengeAtro: 100, zeitraumVon: "2026-01-01", zeitraumBis: "2026-12-31" });
    const spaet = strom({ id: "j2", mengeAtro: 100, zeitraumVon: "2028-01-01", zeitraumBis: "2028-12-31" });
    const luecke = jahresBalken([frueh, spaet], 2026).balken;
    expect(luecke.map((b) => b.jahr)).toEqual([2026, 2027, 2028]);
    expect(luecke[1]).toMatchObject({ wertText: "0", pct: 0 });
  });

  it("Keine Kachel mischt Einheiten auf einer Skala", () => {
    // outputMengen: getrennte Basen je Einheit (MWh vs. t).
    const m = outputMengen(outputsAlle, outputsAlle);
    expect(m.basisEnergetisch).toContain("MWh/a");
    expect(m.basisStofflich).toContain("t/a");
    expect(m.basisEnergetisch).not.toBe(m.basisStofflich);
    // outputJahre: gemeinsame JAHRESachse, aber eigene Werteskala je Reihe.
    const j = outputJahre([oStrom, oWaerme, oCo2], 2026);
    expect(j.energie.balken.map((b) => b.jahr)).toEqual(j.stofflich.balken.map((b) => b.jahr));
    expect(j.energie.skalaText).toContain("MWh/a");
    expect(j.stofflich.skalaText).toContain("t/a");
    expect(j.energie.max).not.toBe(j.stofflich.max);
  });
});
