import { describe, expect, it } from "vitest";

import {
  belegtypZeilen,
  clusterZeilen,
  jahresBalken,
  kpiKarten,
  preisDaten,
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
  produktLabel: "Wasserstoff",
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
  it("zaehlt Auswahl, Trockenmasse, Pruefquote und Erfassungsgrad (sicht=alle)", () => {
    const k = kpiKarten(alle, "alle");
    expect(k).toHaveLength(4);
    expect(k[0]).toMatchObject({ wert: "3", einheit: "Belege", label: "in der auswahl." });
    expect(k[0]!.caption).toBe("2 Feedstock · 1 Outputs");
    expect(k[1]).toMatchObject({ wert: "150", einheit: "t atro/a", label: "trockenmasse." });
    expect(k[1]!.caption).toContain("aus 1.500 t FM/a");
    expect(k[1]!.caption).toContain("Bedarf 500 MWh/a");
    expect(k[2]).toMatchObject({ wert: "33", einheit: "%", label: "belege geprüft." });
    expect(k[2]!.caption).toBe("1 von 3 · 1 in Prüfung");
    expect(k[3]).toMatchObject({ wert: "60", einheit: "%", label: "ø erfassungsgrad." });
    expect(k[3]!.caption).toBe("1 Beleg unter 50 %");
  });

  it("zeigt bei sicht=outputs den Energiebedarf je Einheit", () => {
    const k = kpiKarten([o1], "outputs");
    expect(k[1]).toMatchObject({ wert: "500", einheit: "MWh/a", label: "energiebedarf." });
  });

  it("meldet vollstaendige Erfassung ohne Ausreisser", () => {
    const k = kpiKarten([f1], "alle");
    expect(k[3]!.caption).toBe("alle Belege über 50 %");
  });
});

describe("clusterZeilen", () => {
  it("summiert t atro je Cluster, pct relativ zum Maximum, flache Clusterfarbe + Orb-Asset", () => {
    const z = clusterZeilen(alle, alle, "alle");
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
    const z = clusterZeilen(alle, [f1], "alle");
    expect(z).toHaveLength(2);
    expect(z[1]!.wertText).toBe("0");
  });

  it("zaehlt bei sicht=outputs Belege je Gruppe; add_ons nutzt den waerme-Orb", () => {
    const addOn = strom({ id: "o2", art: "output", gruppe: "add_ons", mengeWert: 10, mengeEinheit: "t/a" });
    const z = clusterZeilen([o1, addOn], [o1, addOn], "outputs");
    expect(z.map((r) => r.key)).toEqual(["wasserstoff", "add_ons"]);
    expect(z[0]).toMatchObject({ wertText: "1 Beleg", meta: "500 MWh/a" });
    expect(z[1]!.orb).toBe("/orbs/output/waerme.webp");
  });
});

describe("qualitaetsDaten", () => {
  it("bildet Anteile A-D und die A+B-Quote nur aus bewerteten Stroemen", () => {
    const q = qualitaetsDaten([f1, f2, o1, strom({ id: "u", qualitaet: null })]);
    expect(q.segmente.map((s) => s.stufe)).toEqual(["A", "B", "C", "D"]);
    expect(q.segmente[0]!.anteil).toBeCloseTo(2 / 3);
    expect(q.abProzent).toBe(100);
    expect(q.zeilen.find((z) => z.stufe === "A")!.anzahl).toBe(2);
    expect(q.zeilen.find((z) => z.stufe === "C")!.anzahl).toBe(0);
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
    expect(s.feedPeak).toBe(0);
    expect(s.out).toBeNull();
    expect(s.notiz).toBe("Angebotsspitze im Januar");
  });

  it("gewichtet den Bedarf gleich und nennt beide Spitzen", () => {
    const o = strom({
      id: "o3",
      art: "output",
      saisonalitaet: [100, 100, 100, 100, 100, 100, 100, 100, 100, 120, 100, 100],
    });
    const s = saisonDaten([f1, o]);
    expect(s.outPeak).toBe(9);
    expect(s.notiz).toBe("Angebotsspitze im Januar · Bedarfsspitze im Oktober");
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
    const j = jahresBalken([f1, f2], "alle", 2026);
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

describe("preisDaten", () => {
  it("gewichtet den Feedstock-Preis nach t atro und spannt den Korridor auf", () => {
    const p = preisDaten([f1, f2], "alle");
    // (10*100 + 16*50) / 150 = 12
    expect(p.stats[0]).toMatchObject({ wert: "12", einheit: "€/t" });
    expect(p.korridor).toMatchObject({ minText: "5", maxText: "24" });
    expect(p.korridor!.pos).toBe(37); // (12-5)/(24-5)
  });

  it("laesst Stroeme ohne Preis aus der Gewichtung und meldet leere Auswahl", () => {
    expect(preisDaten([strom({ id: "n", mengeAtro: 10 })], "alle").stats).toHaveLength(0);
  });

  it("mittelt Outputs je Preiseinheit ohne Korridor", () => {
    const o2 = strom({ id: "o5", art: "output", preis: 12, preisEinheit: "€/MWh" });
    const p = preisDaten([o1, o2], "outputs");
    expect(p.stats[0]).toMatchObject({ wert: "10", einheit: "€/MWh" });
    expect(p.korridor).toBeNull();
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
