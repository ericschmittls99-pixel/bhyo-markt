import { describe, expect, it } from "vitest";

import { sortiereStroeme } from "./stroeme-modell";
import {
  biomasseZeileZuStrom,
  outputZeileZuStrom,
  type BiomasseZeile,
  type OutputZeile,
} from "./stroeme-zeilen";

// Der Postgres-Treiber im Worker liefert Aggregat- und Geometrie-Ausdruecke
// nicht zwingend als JS-Array/-Number, sondern als Zeichenkette. Die Tests
// schicken deshalb beide Formen durch den Mapping-Pfad.

const biomasseBasis: BiomasseZeile = {
  id: "b1",
  akteurName: "Hof Müller",
  sektor: "landwirtschaft",
  bezeichnung: "Rindergülle",
  kontaktperson: null,
  ort: "Rülzheim",
  landkreis: "Germersheim",
  regionIds: [],
  regionNamen: [],
  lng: null,
  lat: null,
  cluster: "guelle_mist",
  materialartCode: "rinderguelle",
  materialartLabel: "Rindergülle",
  mengeFm: "1200",
  tsAnteil: "8.5",
  aschegehalt: null,
  mengeAtro: "102",
  preisMin: null,
  preisMittel: "4",
  preisMax: null,
  preisHerkunft: null,
  zeitraumVon: "2026-01-01",
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: "B",
  status: "geprueft",
  createdAt: new Date("2026-09-01T10:00:00Z"),
  belegTyp: null,
  belegDateiKey: null,
  belegLinkUrl: null,
  belegExtern: null,
  belegGueltigBis: null,
  belegErstelltAm: null,
  belegMetadata: null,
};

const outputBasis: OutputZeile = {
  id: "o1",
  akteurName: "Stadtwerke",
  sektor: "energie",
  bezeichnung: null,
  kontaktperson: null,
  ort: null,
  landkreis: null,
  regionIds: [],
  regionNamen: [],
  lng: null,
  lat: null,
  gruppe: "h2",
  produktCode: "h2_druck",
  produktLabel: "Wasserstoff (Druck)",
  kategorie: "target",
  mengeWert: "50",
  mengeEinheit: "t_a",
  preis: null,
  preisEinheit: null,
  zeitraumVon: null,
  zeitraumBis: null,
  saisonalitaet: null,
  qualitaet: "C",
  status: "entwurf",
  createdAt: new Date("2026-09-02T10:00:00Z"),
  belegTyp: null,
  belegDateiKey: null,
  belegLinkUrl: null,
  belegExtern: null,
  belegGueltigBis: null,
  belegErstelltAm: null,
  belegMetadata: null,
};

describe("biomasseZeileZuStrom: regionNamen/regionIds", () => {
  it("liefert echte Arrays, wenn der Treiber JSON-Text liefert", () => {
    const s = biomasseZeileZuStrom({
      ...biomasseBasis,
      regionIds: '["r1","r2"]',
      regionNamen: '["Nordhessen","Werra-Meißner"]',
    });
    expect(s.regionIds).toEqual(["r1", "r2"]);
    expect(s.regionNamen).toEqual(["Nordhessen", "Werra-Meißner"]);
    expect(s.regionNamen.join(", ")).toBe("Nordhessen, Werra-Meißner");
  });

  it("liefert echte Arrays, wenn der Treiber bereits Arrays liefert", () => {
    const s = biomasseZeileZuStrom({
      ...biomasseBasis,
      regionIds: ["r1"],
      regionNamen: ["Nordhessen"],
    });
    expect(s.regionNamen).toEqual(["Nordhessen"]);
  });

  it("liefert leere Arrays bei null/leerem Aggregat", () => {
    expect(biomasseZeileZuStrom({ ...biomasseBasis, regionNamen: null }).regionNamen).toEqual([]);
    expect(biomasseZeileZuStrom({ ...biomasseBasis, regionNamen: "[]" }).regionNamen).toEqual([]);
  });
});

describe("biomasseZeileZuStrom: lng/lat", () => {
  it("konvertiert Treiber-Zeichenketten in Zahlen", () => {
    const s = biomasseZeileZuStrom({ ...biomasseBasis, lng: "8.9876", lat: "49.1234" });
    expect(s.lng).toBe(8.9876);
    expect(s.lat).toBe(49.1234);
  });

  it("laesst null als null durch", () => {
    const s = biomasseZeileZuStrom(biomasseBasis);
    expect(s.lng).toBeNull();
    expect(s.lat).toBeNull();
  });
});

describe("outputZeileZuStrom", () => {
  it("konvertiert regionNamen identisch zum Biomasse-Pfad", () => {
    const s = outputZeileZuStrom({
      ...outputBasis,
      regionNamen: '["Südpfalz"]',
      regionIds: '["r9"]',
    });
    expect(s.regionNamen).toEqual(["Südpfalz"]);
    expect(s.regionIds).toEqual(["r9"]);
  });
});

describe("Sortierung nach Region", () => {
  it("sortiert nach dem vollen ersten Regionsnamen, nicht nach dem ersten Zeichen", () => {
    const a = biomasseZeileZuStrom({ ...biomasseBasis, id: "a", regionNamen: '["Bergstraße"]' });
    const b = biomasseZeileZuStrom({ ...biomasseBasis, id: "b", regionNamen: '["Bayerischer Wald"]' });
    const sortiert = sortiereStroeme([a, b], "region", "auf");
    // "Bayerischer Wald" < "Bergstraße" — nur beim Vergleich des vollen Namens.
    expect(sortiert.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
