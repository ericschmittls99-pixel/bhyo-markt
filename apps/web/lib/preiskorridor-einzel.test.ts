import { describe, expect, it } from "vitest";

import { ZU_WENIG, preisKorridorEinzel, vergleichsStroeme, wertungFeedstock, wertungOutput } from "./preiskorridor-einzel";
import type { Strom } from "./stroeme-modell";

const basis = (patch: Partial<Strom>): Strom =>
  ({
    id: "x",
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
    cluster: "guelle_mist",
    materialartCode: null,
    materialartLabel: null,
    mengeFm: null,
    tsAnteil: null,
    aschegehalt: null,
    mengeAtro: 100,
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
    status: "geprueft",
    reserviertBhyo: false,
    reserviertSeit: null,
    erstelltAm: "2026-01-01",
    beleg: null,
    vollstaendigkeit: 0,
    ...patch,
  }) as Strom;

const feed = (id: string, mittel: number | null, min?: number, max?: number, cluster = "guelle_mist") =>
  basis({ id, cluster, preisMittel: mittel, preisMin: min ?? mittel, preisMax: max ?? mittel });
const labels = { cluster: { guelle_mist: "Gülle & Mist" } };

describe("E38 Vorgabe 1: der Strom rechnet nicht in sein eigenes Band", () => {
  it("ein Cluster mit genau einem weiteren Strom zeigt dessen Werte, nicht einen Mix mit dem eigenen", () => {
    const ich = feed("ich", 10);
    const anderer = feed("anderer", 40, 30, 50);
    const peers = vergleichsStroeme(ich, [ich, anderer]);
    expect(peers.map((s) => s.id)).toEqual(["anderer"]);
    // Und mit zwei anderen ist das Band exakt deren Band — ohne "ich".
    const dritter = feed("dritter", 60, 50, 70);
    const k = preisKorridorEinzel(ich, [ich, anderer, dritter], labels);
    expect(k.band).toMatchObject({ min: 40, mittel: 50, max: 60, n: 2 });
  });
});

describe("E38 Vorgabe 2: mindestens zwei Vergleichswerte, Preislose zaehlen nicht", () => {
  it("ein einziger Vergleichsstrom ergibt den Zustand „zu wenig Vergleichswerte“", () => {
    const k = preisKorridorEinzel(feed("ich", 10), [feed("ich", 10), feed("anderer", 40)], labels);
    expect(k.band).toBeNull();
    expect(k.zustand).toBe(ZU_WENIG);
    expect(k.wertung).toBeNull();
  });
  it("Stroeme ohne Preis werden nicht als 0 gezaehlt", () => {
    const pool = [feed("ich", 10), feed("a", 40), feed("ohne1", null), feed("ohne2", null)];
    const k = preisKorridorEinzel(feed("ich", 10), pool, labels);
    expect(k.zustand).toBe(ZU_WENIG);
    const mit = preisKorridorEinzel(feed("ich", 10), [...pool, feed("b", 60)], labels);
    expect(mit.band?.n).toBe(2);
    expect(mit.band?.mittel).toBe(50);
  });
  it("fremde Cluster und Outputs sind keine Vergleichsstroeme", () => {
    const pool = [feed("ich", 10), feed("a", 40, 40, 40, "stroh"), basis({ id: "o", art: "output", gruppe: "wasserstoff" })];
    expect(vergleichsStroeme(feed("ich", 10), pool)).toEqual([]);
  });
});

describe("E38 Vorgabe 3: Wertungsrichtung je Sicht", () => {
  it("Feedstock: niedriger Preis ist guenstiger fuer bhyo, hoeherer teurer", () => {
    expect(wertungFeedstock(30, 50)).toBe("20 €/t atro unter dem Cluster-Mittel: günstiger für bhyo");
    expect(wertungFeedstock(70, 50)).toBe("20 €/t atro über dem Cluster-Mittel: teurer für bhyo");
    expect(wertungFeedstock(50, 50)).toBe("auf dem Cluster-Mittel");
  });
  it("Feedstock im Annahmeentgelt (E14 negativ): mehr Entgelt ist guenstiger fuer bhyo", () => {
    expect(wertungFeedstock(-30, -10)).toBe("20 €/t atro höheres Annahmeentgelt als das Cluster-Mittel: günstiger für bhyo");
    expect(wertungFeedstock(-5, -10)).toBe("5 €/t atro niedrigeres Annahmeentgelt als das Cluster-Mittel: teurer für bhyo");
  });
  it("Outputs: hoeherer Erloes ist besser fuer bhyo, niedrigerer schlechter", () => {
    expect(wertungOutput(200, 150, "€/MWh")).toBe("50 €/MWh über dem Gruppen-Mittel: besser für bhyo");
    expect(wertungOutput(100, 150, "€/MWh")).toBe("50 €/MWh unter dem Gruppen-Mittel: schlechter für bhyo");
  });
  it("Output-Band: Punkt gegen das Mittel der Produktgruppe in der Einheit des Stroms", () => {
    const h2 = (id: string, preis: number | null) =>
      basis({ id, art: "output", gruppe: "wasserstoff", gruppeLabel: "Wasserstoff", produktCode: "h2_hochdruck", preis, preisEinheit: "€/MWh", mengeWert: 100, mengeEinheit: "MWh/a" });
    const k = preisKorridorEinzel(h2("ich", 180), [h2("ich", 180), h2("a", 150), h2("b", 170), h2("ohne", null)], labels);
    expect(k.einheit).toBe("€/MWh");
    expect(k.eigen).toEqual({ min: 180, mittel: 180, max: 180 });
    expect(k.band).toMatchObject({ min: 150, mittel: 160, max: 170, n: 3 - 1 });
    expect(k.wertung).toBe("20 €/MWh über dem Gruppen-Mittel: besser für bhyo");
  });
});
