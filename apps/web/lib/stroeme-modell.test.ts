import { describe, expect, it } from "vitest";

import {
  facettenOptionen,
  filterAusSearchParams,
  filterStroeme,
  GETEILTE_FILTER_PARAMS,
  LEERER_FILTER,
  type Strom,
} from "./stroeme-modell";

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
  reserviertBhyo: false,
  reserviertSeit: null,
  erstelltAm: "2026-09-01",
  beleg: null,
  vollstaendigkeit: 0,
  ...patch,
});

describe("filterAusSearchParams", () => {
  it("liest Einzelwerte und kommagetrennte Listen", () => {
    const f = filterAusSearchParams({
      q: "holz",
      cluster: "a,b",
      status: ["geprueft"],
      mengeMin: "10",
    });
    expect(f.q).toBe("holz");
    expect(f.cluster).toEqual(["a", "b"]);
    expect(f.status).toEqual(["geprueft"]);
    expect(f.mengeMin).toBe("10");
    expect(f.region).toEqual([]);
    expect(f.gruppe).toEqual([]);
  });
});

describe("gruppe-Facette", () => {
  const pool = [
    strom({ id: "o1", art: "output", gruppe: "wasserstoff" }),
    strom({ id: "o2", art: "output", gruppe: "derivate" }),
    strom({ id: "b1", art: "biomasse" }),
  ];
  it("filtert Output-Ströme über die Gruppe; Biomasse bleibt (wie cluster umgekehrt)", () => {
    const f = { ...LEERER_FILTER, gruppe: ["wasserstoff"] };
    expect(filterStroeme(pool, f).map((s) => s.id)).toEqual(["o1", "b1"]);
  });
  it("leere Facette lässt alles durch", () => {
    expect(filterStroeme(pool, LEERER_FILTER)).toHaveLength(3);
  });
});

describe("verfuegbarkeit-Facette (AP1j PR 3)", () => {
  it("filtert nach dem abgeleiteten Status; Stroeme ohne Ableitung fallen raus", () => {
    const frei = strom({
      id: "f",
      verfuegbarkeit: { status: "verfuegbar", reserviertZusatz: false },
    });
    const weg = strom({
      id: "w",
      verfuegbarkeit: { status: "vergeben_extern", reserviertZusatz: false },
    });
    const ohne = strom({ id: "o" });
    const erg = filterStroeme([frei, weg, ohne], {
      ...LEERER_FILTER,
      verfuegbarkeit: ["verfuegbar"],
    });
    expect(erg.map((s) => s.id)).toEqual(["f"]);
  });

  it("facettenOptionen liefert die feste 6er-Liste mit Art-Labels", () => {
    const opt = facettenOptionen("output", [], [], {});
    expect(opt.verfuegbarkeit!.map((o) => o.wert)).toEqual([
      "verfuegbar",
      "vergeben_extern",
      "vergeben_bhyo",
      "reserviert_bhyo",
      "noch_nicht_verfuegbar",
      "abgelaufen",
    ]);
    expect(opt.verfuegbarkeit![0]!.label).toBe("Offen");
    expect(facettenOptionen("biomasse", [], [], {}).verfuegbarkeit![0]!.label).toBe(
      "Verfügbar",
    );
  });
});

describe("GETEILTE_FILTER_PARAMS", () => {
  it("enthält die karte./auswertung.-Parameter inkl. sicht und gruppe", () => {
    expect(GETEILTE_FILTER_PARAMS).toContain("sicht");
    expect(GETEILTE_FILTER_PARAMS).toContain("gruppe");
    expect(GETEILTE_FILTER_PARAMS).toContain("q");
    expect(GETEILTE_FILTER_PARAMS).not.toContain("detail");
    expect(GETEILTE_FILTER_PARAMS).not.toContain("ansicht");
  });
});
