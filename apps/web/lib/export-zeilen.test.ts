import { describe, expect, it } from "vitest";

import { exportAnsicht, exportZeilen } from "./export-zeilen";
import { LEERER_FILTER, filterStroeme, type Strom } from "./stroeme-modell";

// Minimaler Strom: nur, was Filter und Export hier brauchen.
const strom = (patch: Partial<Strom>): Strom =>
  ({
    id: "s",
    art: "biomasse",
    akteurId: "a",
    akteurName: "A",
    sektor: null,
    sektorLabel: null,
    bezeichnung: null,
    ort: null,
    regionIds: [],
    regionNamen: [],
    verwaltung: null,
    lat: null,
    lng: null,
    cluster: null,
    materialartCode: null,
    materialartLabel: null,
    mengeFm: null,
    mengeAtro: null,
    tsAnteil: null,
    aschegehalt: null,
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
    zeitraumBis: "2030-12-31",
    saisonalitaet: null,
    qualitaet: null,
    status: "geprueft",
    reserviertBhyo: false,
    reserviertSeit: null,
    erstelltAm: "2026-01-01",
    beleg: null,
    vollstaendigkeit: 0,
    ...patch,
  }) as Strom;

const frei = strom({
  id: "frei",
  verfuegbarkeit: { status: "verfuegbar", reserviertZusatz: false } as Strom["verfuegbarkeit"],
});
const weg = strom({
  id: "weg",
  verfuegbarkeit: { status: "vergeben_extern", reserviertZusatz: false } as Strom["verfuegbarkeit"],
});
const pool = [frei, weg];

describe("Export-Scope kommt von der aufrufenden Ansicht (Produktionsfehler 26.09.2026)", () => {
  it("Export aus stroeme. mit gesetzter Verfuegbarkeit liefert genau die Zeilen der Liste", () => {
    const liste = filterStroeme(pool, { ...LEERER_FILTER, verfuegbarkeit: ["verfuegbar"] }, "stroeme");
    const datei = exportZeilen(pool, { verfuegbarkeit: "verfuegbar", ansicht: "stroeme" });
    expect(datei.map((s) => s.id)).toEqual(liste.map((s) => s.id));
    expect(datei.map((s) => s.id)).toEqual(["frei"]);
  });

  it("Export aus auswertung. wendet die Verfuegbarkeit an wie die Ansicht (E41; vorher E32-Ausnahme)", () => {
    const liste = filterStroeme(pool, { ...LEERER_FILTER, verfuegbarkeit: ["verfuegbar"] }, "auswertung");
    const datei = exportZeilen(pool, { verfuegbarkeit: "verfuegbar", ansicht: "auswertung" });
    expect(datei.map((s) => s.id)).toEqual(liste.map((s) => s.id));
    expect(datei).toHaveLength(1);
  });

  it("ohne oder mit unbekannter Ansicht gilt auswertung (alte Adressen bleiben gueltig)", () => {
    expect(exportAnsicht(null)).toBe("auswertung");
    expect(exportAnsicht("irgendwas")).toBe("auswertung");
    expect(exportAnsicht("karte")).toBe("karte");
  });
});
