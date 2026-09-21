import { describe, expect, it } from "vitest";

import {
  auswahlZeile,
  belegtypZeilen,
  clusterZeilen,
  jahresBalken,
  kpiKarten,
  potenzialZeilen,
  preisKorridorZeilen,
  preisStats,
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
  it("liefert Pruefquote, Trockenmasse, gewichteten Preis und Regionenpotenzial (sicht=feedstock)", () => {
    const k = kpiKarten([f1, f2], "feedstock");
    expect(k).toHaveLength(4);
    expect(k[0]).toMatchObject({ wert: "50", einheit: "%", label: "belege geprüft." });
    expect(k[0]!.caption).toBe("1 von 2 · 0 in Prüfung");
    expect(k[1]).toMatchObject({ wert: "150", einheit: "t atro/a", label: "trockenmasse." });
    expect(k[1]!.caption).toBe("aus 1.500 t FM/a");
    // (10*100 + 16*50) / 150 = 12
    expect(k[2]).toMatchObject({ wert: "12", einheit: "€/t", label: "ø preis." });
    expect(k[2]!.caption).toBe("gewichtet nach t atro/a");
    // Mittel 10*100 + 16*50 = 1.800; Min 5*100+8*50 = 900; Max 20*100+24*50 = 3.200
    expect(k[3]).toMatchObject({ wert: "1.800", einheit: "€/a", label: "regionenpotenzial." });
    expect(k[3]!.caption).toBe("Spanne 900 – 3.200 €/a");
  });

  it("weist Belege ohne Preis aus statt sie still zu ignorieren", () => {
    const ohnePreis = strom({ id: "n", cluster: "lipide_spezialfeedstocks", mengeAtro: 10 });
    const k = kpiKarten([f1, ohnePreis], "feedstock");
    expect(k[2]!.caption).toBe("gewichtet nach t atro/a · 1 Beleg ohne Preis");
    expect(k[3]).toMatchObject({ wert: "1.000", einheit: "€/a" });
  });

  it("zeigt ohne jeden Preis einen Strich statt 0", () => {
    const k = kpiKarten([strom({ id: "n", mengeAtro: 10 })], "feedstock");
    expect(k[2]).toMatchObject({ wert: "–", caption: "keine Preise in der Auswahl" });
    expect(k[3]!.wert).toBe("–");
  });

  it("skaliert grosse Potenziale auf Mio. €/a", () => {
    const gross = strom({ id: "g", mengeAtro: 100000, preisMittel: 25 });
    const k = kpiKarten([gross], "feedstock");
    expect(k[3]).toMatchObject({ wert: "2,50", einheit: "Mio. €/a" });
    expect(k[3]!.caption).toBe("Spanne 2.500.000 – 2.500.000 €/a");
  });

  it("summiert bei sicht=outputs den Energiebedarf der Targets nach Hu und nennt CO2 separat", () => {
    const h2 = strom({
      id: "oh2",
      art: "output",
      gruppe: "wasserstoff",
      produktCode: "h2_hochdruck",
      kategorie: "target",
      mengeWert: 120,
      mengeEinheit: "t/a",
    });
    const co2 = strom({
      id: "oco2",
      art: "output",
      gruppe: "add_ons",
      produktCode: "co2",
      kategorie: "add_on",
      mengeWert: 800,
      mengeEinheit: "t/a",
    });
    const syn = strom({
      id: "osyn",
      art: "output",
      gruppe: "primaerprodukte",
      produktCode: "synthesegas",
      kategorie: "target",
      mengeWert: 10,
      mengeEinheit: "t/a",
    });
    const k = kpiKarten([o1, h2, co2, syn], "outputs");
    expect(k[0]!.caption).toBe("3 Output-Gruppen");
    // 500 MWh direkt + 120 t H2 * 33,326 kWh/kg = 3.999,07 MWh -> 4.499
    expect(k[1]).toMatchObject({ wert: "4.499", einheit: "MWh/a", label: "energiebedarf." });
    expect(k[1]!.caption).toContain("Hu");
    expect(k[1]!.caption).toContain("dazu 800 t CO2/a");
    expect(k[1]!.caption).toContain("1 Beleg ohne Heizwert");
  });

  it("laesst CO2- und ohne-Heizwert-Hinweis weg, wenn nichts da ist", () => {
    const k = kpiKarten([o1], "outputs");
    expect(k[1]).toMatchObject({ wert: "500", einheit: "MWh/a" });
    expect(k[1]!.caption).not.toContain("CO2");
    expect(k[1]!.caption).not.toContain("ohne Heizwert");
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
    expect(s.feed![11]).toBe(93);
    expect(s.out).toBeNull();
  });

  it("gewichtet den Bedarf gleich", () => {
    const o = strom({
      id: "o3",
      art: "output",
      saisonalitaet: [100, 100, 100, 100, 100, 100, 100, 100, 100, 120, 100, 100],
    });
    const s = saisonDaten([f1, o]);
    expect(s.out![9]).toBe(120);
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
  it("zaehlt einen Strom fuer jedes Jahr seines Zeitraums (t atro im feed-Modus)", () => {
    const j = jahresBalken([f1, f2], "feedstock", 2026);
    expect(j.map((b) => b.jahr)).toEqual([2026, 2027, 2028, 2029, 2030, 2031]);
    expect(j[0]).toMatchObject({ wertText: "50", aktuell: true });
    expect(j[1]!.wertText).toBe("150");
    expect(j[4]!.wertText).toBe("50");
    expect(j[1]!.pct).toBe(100);
  });

  it("zaehlt offene Zeitraeume durchgehend und Outputs als Anzahl", () => {
    const offen = strom({ id: "o4", art: "output", zeitraumVon: null, zeitraumBis: null });
    const j = jahresBalken([offen], "outputs", 2026);
    expect(j.every((b) => b.wertText === "1")).toBe(true);
  });
});

describe("potenzialZeilen", () => {
  it("spannt je Cluster Min/Mittel/Max von Preis × t atro auf einer 0..Max-Skala auf", () => {
    const z = potenzialZeilen([f1, f2], [f1, f2]);
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
    const z = potenzialZeilen([nurMittel, ohne], [nurMittel, ohne]);
    expect(z[0]).toMatchObject({ minText: "50", maxText: "50", leer: false });
    expect(z[1]!.leer).toBe(true);
  });

  it("liefert je Materialart eine Unterzeile auf derselben Skala", () => {
    const z = potenzialZeilen([f1, f2], [f1, f2]);
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

  it("gewichtet das Cluster-Mittel nach t atro", () => {
    const a = strom({ id: "a", cluster: "lipide_spezialfeedstocks", mengeAtro: 100, preisMittel: 10 });
    const b = strom({ id: "b", cluster: "lipide_spezialfeedstocks", mengeAtro: 50, preisMittel: 16 });
    const z = preisKorridorZeilen([a, b], [a, b]);
    expect(z[0]!.mittelText).toBe("12");
  });
});

describe("preisStats", () => {
  it("teilt die Output-Preise in Targets (ct/kWh), Waerme (ct/kWh) und CO2 (€/kg)", () => {
    // o1: H2 target, 5 €/kg -> 15,00 ct/kWh, Energie 500 MWh
    const target = { ...o1, preis: 5, preisEinheit: "€/kg" };
    const strom2 = strom({
      id: "ostrom",
      art: "output",
      gruppe: "primaerprodukte",
      produktCode: "strom",
      kategorie: "target",
      mengeWert: 500,
      mengeEinheit: "MWh/a",
      preis: 120,
      preisEinheit: "€/MWh",
    });
    const waerme = strom({
      id: "owaerme",
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
      id: "oco2p",
      art: "output",
      gruppe: "add_ons",
      produktCode: "co2",
      kategorie: "add_on",
      mengeWert: 800,
      mengeEinheit: "t/a",
      preis: 80,
      preisEinheit: "€/t",
    });
    const p = preisStats([target, strom2, waerme, co2]);
    // Targets kWh-gewichtet, beide 500 MWh: (15,0035 + 12) / 2 = 13,50
    expect(p[0]).toMatchObject({ wert: "13,50", einheit: "ct/kWh" });
    expect(p[0]!.label).toContain("target");
    expect(p[1]).toMatchObject({ wert: "8", einheit: "ct/kWh" });
    expect(p[1]!.label).toContain("wärme");
    expect(p[2]).toMatchObject({ wert: "0,08", einheit: "€/kg" });
    expect(p[2]!.label).toContain("CO2");
  });

  it("laesst Preisgruppen ohne Daten weg", () => {
    expect(preisStats([{ ...o1, preis: null }])).toHaveLength(0);
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
