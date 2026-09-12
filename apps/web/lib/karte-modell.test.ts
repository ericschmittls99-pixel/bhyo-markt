import { describe, expect, it, vi } from "vitest";

import {
  aggregiere,
  bboxKm,
  geojsonOderNull,
  markerGroesse,
  maxMengeJe,
  punkteInBbox,
  qualitaetsRing,
  stromZuPunkt,
  sucheKarte,
  type KartePunkt,
} from "./karte-modell";
import type { Strom } from "./stroeme-modell";

const basis: Strom = {
  id: "b1",
  art: "biomasse",
  akteurName: "Hof Müller",
  sektor: "landwirtschaft",
  bezeichnung: "Rindergülle",
  kontaktperson: null,
  ort: "Rülzheim",
  landkreis: "Germersheim",
  regionIds: ["r1"],
  regionNamen: ["Südpfalz"],
  lng: 8.4,
  lat: 49.2,
  cluster: "guelle_mist",
  materialartCode: "rinderguelle",
  materialartLabel: "Rindergülle",
  mengeFm: 1200,
  tsAnteil: 8.5,
  aschegehalt: 15,
  mengeAtro: 102,
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
  zeitraumVon: "2026-01-01",
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: "B",
  status: "geprueft",
  erstelltAm: "2026-09-01",
  beleg: null,
  vollstaendigkeit: 70,
};

const outputStrom: Strom = {
  ...basis,
  id: "o1",
  art: "output",
  akteurName: "Stadtwerke",
  cluster: null,
  materialartLabel: null,
  mengeAtro: null,
  gruppe: "wasserstoff",
  gruppeLabel: "Wasserstoff",
  produktLabel: "Wasserstoff (Druck)",
  mengeWert: 50,
  mengeEinheit: "t/a",
  lng: 8.6,
  lat: 49.3,
};

describe("stromZuPunkt", () => {
  it("Biomasse: atro-Menge, Cluster-Key, t atro/a, Titel = Akteur", () => {
    const p = stromZuPunkt(basis)!;
    expect(p.menge).toBe(102);
    expect(p.farbeKey).toBe("guelle_mist");
    expect(p.einheit).toBe("t atro/a");
    expect(p.titel).toBe("Hof Müller");
    expect(p.untertitel).toBe("Rindergülle");
  });
  it("Output: mengeWert + Einheit, Gruppen-Key, Produkt-Label", () => {
    const p = stromZuPunkt(outputStrom)!;
    expect(p.menge).toBe(50);
    expect(p.einheit).toBe("t/a");
    expect(p.farbeKey).toBe("wasserstoff");
    expect(p.untertitel).toBe("Wasserstoff (Druck)");
  });
  it("ohne Pin → null (kein Fehler, kein Log)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(stromZuPunkt({ ...basis, lng: null, lat: null })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("markerGroesse", () => {
  it("skaliert 12–38 mit Wurzel", () => {
    expect(markerGroesse(0, 100)).toBe(12);
    expect(markerGroesse(100, 100)).toBe(38);
    expect(markerGroesse(25, 100)).toBe(25);
  });
  it("maxMenge 0 → Mittelgroesse 14", () => {
    expect(markerGroesse(5, 0)).toBe(14);
  });
});

describe("maxMengeJe", () => {
  it("Maximum je art|einheit getrennt", () => {
    const p = [
      stromZuPunkt(basis)!,
      stromZuPunkt({ ...basis, id: "b2", mengeAtro: 500 })!,
      stromZuPunkt(outputStrom)!,
      stromZuPunkt({ ...outputStrom, id: "o2", mengeEinheit: "MWh/a", mengeWert: 9000 })!,
    ];
    const m = maxMengeJe(p);
    expect(m.get("biomasse|t atro/a")).toBe(500);
    expect(m.get("output|t/a")).toBe(50);
    expect(m.get("output|MWh/a")).toBe(9000);
  });
});

describe("aggregiere", () => {
  it("verschmilzt transitiv unter dem Radius", () => {
    const g = aggregiere(
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 95, y: 0 },
        { x: 300, y: 0 },
      ],
      80,
    );
    expect(g).toHaveLength(2);
    expect(g[0]!.indizes).toEqual([0, 1, 2]);
    expect(g[1]!.indizes).toEqual([3]);
  });
  it("Gruppenzentrum = Mittelwert", () => {
    const g = aggregiere([{ x: 0, y: 0 }, { x: 40, y: 20 }], 80);
    expect(g[0]!.x).toBe(20);
    expect(g[0]!.y).toBe(10);
  });
});

describe("bboxKm / punkteInBbox", () => {
  it("rechnet km aus Grad (Breite lat-korrigiert)", () => {
    const { breite, hoehe } = bboxKm([8, 49, 9, 50]);
    expect(hoehe).toBeCloseTo(111.2, 0);
    expect(breite).toBeGreaterThan(70);
    expect(breite).toBeLessThan(75);
  });
  it("zählt Punkte im Ausschnitt", () => {
    const p = [
      { lng: 8.5, lat: 49.5 },
      { lng: 10, lat: 49.5 },
    ] as KartePunkt[];
    expect(punkteInBbox(p, [8, 49, 9, 50])).toBe(1);
  });
});

describe("sucheKarte", () => {
  const punkte = [stromZuPunkt(basis)!, stromZuPunkt(outputStrom)!];
  const regionen = [{ id: "r1", name: "Südpfalz" }];
  it("findet Ströme über Titel/Untertitel/Ort", () => {
    const t = sucheKarte(punkte, regionen, "gülle");
    expect(t.some((x) => x.typ === "strom" && x.id === "b1")).toBe(true);
  });
  it("findet Regionen über den Namen", () => {
    const t = sucheKarte(punkte, regionen, "südpf");
    expect(t.some((x) => x.typ === "region" && x.id === "r1")).toBe(true);
  });
  it("findet Orte dedupliziert", () => {
    const t = sucheKarte(
      [...punkte, stromZuPunkt({ ...basis, id: "b3" })!],
      regionen,
      "rülz",
    );
    expect(t.filter((x) => x.typ === "ort")).toHaveLength(1);
  });
  it("leeres q → leer", () => {
    expect(sucheKarte(punkte, regionen, "  ")).toEqual([]);
  });
});

describe("geojsonOderNull", () => {
  it("String wird geparst, Objekt durchgereicht", () => {
    expect(geojsonOderNull('{"type":"Polygon"}', "r1")).toEqual({ type: "Polygon" });
    expect(geojsonOderNull({ type: "Polygon" }, "r1")).toEqual({ type: "Polygon" });
  });
  it("Murks wird protokolliert, nicht still geschluckt", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(geojsonOderNull("quatsch", "r1")).toBeNull();
    expect(geojsonOderNull(42, "r1")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("qualitaetsRing (Mockup-Randlogik, Review: duenner)", () => {
  it("A solid 2 / B solid 1,5 / C dashed / D dotted", () => {
    expect(qualitaetsRing("A")).toEqual({ breite: 2, stil: "solid" });
    expect(qualitaetsRing("B")).toEqual({ breite: 1.5, stil: "solid" });
    expect(qualitaetsRing("C")).toEqual({ breite: 1, stil: "dashed" });
    expect(qualitaetsRing("D")).toEqual({ breite: 1, stil: "dotted" });
  });
  it("ohne Bewertung dezenter 1-px-Rand", () => {
    expect(qualitaetsRing(null)).toEqual({ breite: 1, stil: "solid" });
  });
});

describe("orb-Asset am Kartenpunkt", () => {
  it("Biomasse → Cluster-Orb, Output → Gruppen-Orb", () => {
    expect(stromZuPunkt(basis)!.orb).toBe("/orbs/cluster/guelle_mist.webp");
    expect(stromZuPunkt(outputStrom)!.orb).toBe("/orbs/output/wasserstoff.webp");
  });
  it("Add-Ons → Produkt-Orb (asche/co2/waerme)", () => {
    const p = stromZuPunkt({
      ...outputStrom,
      gruppe: "add_ons",
      produktCode: "asche",
    })!;
    expect(p.orb).toBe("/orbs/output/asche.webp");
  });
});
