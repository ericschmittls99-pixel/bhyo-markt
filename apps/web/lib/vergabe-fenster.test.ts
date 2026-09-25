import { describe, expect, it } from "vitest";

import {
  istLeer,
  trifftVergabefenster,
  type FensterStrom,
  type VergabeFenster,
} from "./vergabe-fenster";

/** Fenster: das Jahr 2027. */
const F: VergabeFenster = { von: "2027-01", bis: "2027-12", nichtVergeben: false };

function strom(vergaben: { von?: string | null; bis?: string | null }[]): FensterStrom {
  return {
    zeitraumVon: "2020-01-01",
    zeitraumBis: "2099-12-31",
    vergaben: vergaben.map((v) => ({
      vergebenVon: v.von === undefined ? null : v.von,
      vergebenBis: v.bis === undefined ? null : v.bis,
    })),
  };
}

describe("Die vier Kanten", () => {
  it("1 — beginnt davor, endet im Fenster: Treffer", () => {
    const s = strom([{ von: "2025-03-01", bis: "2027-06-30" }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("2 — liegt vollständig im Fenster: Treffer", () => {
    const s = strom([{ von: "2027-03-01", bis: "2027-09-30" }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("3 — beginnt im Fenster, endet danach: Treffer", () => {
    const s = strom([{ von: "2027-09-01", bis: "2030-01-31" }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("4 — umschließt das Fenster: Treffer", () => {
    // Umgedreht am 25.09.2026: Der Filter beantwortet "was ist in diesem
    // Zeitraum vergeben", nicht "was aendert sich darin". Ein Strom, der
    // 2020-2099 vergeben ist, ist 2027 durchgehend vergeben.
    const s = strom([{ von: "2020-01-01", bis: "2099-12-31" }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("5 — liegt ganz davor oder ganz danach: KEIN Treffer", () => {
    // Ohne diesen Fall pruefte die Reihe nur noch eine Richtung.
    expect(trifftVergabefenster(strom([{ von: "2024-01-01", bis: "2026-12-31" }]), F)).toBe(
      false,
    );
    expect(trifftVergabefenster(strom([{ von: "2028-01-01", bis: "2030-12-31" }]), F)).toBe(
      false,
    );
  });
});

describe("Ränder", () => {
  it("der erste Tag des Startmonats zählt noch dazu", () => {
    expect(trifftVergabefenster(strom([{ von: "2027-01-01", bis: "2030-01-01" }]), F)).toBe(
      true,
    );
  });

  it("der letzte Tag des Endmonats zählt noch dazu", () => {
    expect(trifftVergabefenster(strom([{ von: "2020-01-01", bis: "2027-12-31" }]), F)).toBe(
      true,
    );
  });

  it("einen Tag davor endet: kein Treffer", () => {
    expect(trifftVergabefenster(strom([{ von: "2020-01-01", bis: "2026-12-31" }]), F)).toBe(
      false,
    );
  });

  it("einen Tag danach beginnt: kein Treffer", () => {
    expect(trifftVergabefenster(strom([{ von: "2028-01-01", bis: null }]), F)).toBe(false);
  });
});

describe("Offene Enden werden wie in der Verfügbarkeit ersetzt", () => {
  it("fehlendes vergebenBis zählt bis zum Verfügbarkeitsende", () => {
    // Ende = 2099 → ausserhalb des Fensters; Beginn 2027 → Treffer ueber den Beginn.
    const s = strom([{ von: "2027-05-01", bis: null }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("fehlendes vergebenVon zählt ab dem Verfügbarkeitsbeginn", () => {
    const s = strom([{ von: null, bis: "2027-05-31" }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("beide offen trifft jedes Fenster", () => {
    // Wir wissen nicht, wann sie endet, also koennen wir sie nicht
    // ausschliessen. Ein geratenes Ende waere schlechter als ein weiter
    // Treffer.
    const s = strom([{ von: null, bis: null }]);
    expect(trifftVergabefenster(s, F)).toBe(true);
  });

  it("auch ohne Verfügbarkeitszeitraum bleibt sie ein Treffer", () => {
    const s: FensterStrom = {
      zeitraumVon: null,
      zeitraumBis: null,
      vergaben: [{ vergebenVon: null, vergebenBis: null }],
    };
    expect(trifftVergabefenster(s, F)).toBe(true);
  });
});

describe("Der benannte Zustand: nicht vergeben", () => {
  const ohne: FensterStrom = { zeitraumVon: "2020-01-01", zeitraumBis: "2099-12-31", vergaben: [] };

  it("ohne Vergabe fällt ein Strom bei gesetztem Fenster heraus", () => {
    expect(trifftVergabefenster(ohne, F)).toBe(false);
  });

  it("aber er ist gezielt wählbar — nicht stillschweigend weg", () => {
    expect(trifftVergabefenster(ohne, { ...F, nichtVergeben: true })).toBe(true);
  });

  it("nur der Zustand ohne Fenster zeigt genau die unvergebenen", () => {
    const nurZustand: VergabeFenster = { von: "", bis: "", nichtVergeben: true };
    expect(trifftVergabefenster(ohne, nurZustand)).toBe(true);
    expect(trifftVergabefenster(strom([{ von: "2027-01-01", bis: "2027-12-31" }]), nurZustand)).toBe(
      false,
    );
  });

  it("ein Strom mit Vergabe trifft ueber das Fenster, nicht ueber den Zustand", () => {
    const s = strom([{ von: "2020-01-01", bis: "2099-12-31" }]);
    // Mit Ueberschneidungslogik ist er jetzt ein Treffer — aber ueber das
    // Fenster; der Zustand "nicht vergeben" gilt weiterhin nur fuer Stroeme
    // ganz ohne Vergabe.
    expect(trifftVergabefenster(s, { ...F, nichtVergeben: true })).toBe(true);
    const ausserhalb = strom([{ von: "2024-01-01", bis: "2026-12-31" }]);
    expect(trifftVergabefenster(ausserhalb, { ...F, nichtVergeben: true })).toBe(false);
  });
});

describe("Leerer Filter", () => {
  it("trifft alles", () => {
    expect(istLeer({ von: "", bis: "", nichtVergeben: false })).toBe(true);
    expect(
      trifftVergabefenster(strom([{ von: "2020-01-01", bis: "2099-12-31" }]), {
        von: "",
        bis: "",
        nichtVergeben: false,
      }),
    ).toBe(true);
  });
});
