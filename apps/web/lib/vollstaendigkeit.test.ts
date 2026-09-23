import { describe, expect, it } from "vitest";

import {
  vollstaendigkeit,
  type VollstaendigkeitEingabe,
} from "./vollstaendigkeit";

const vollerFeed: VollstaendigkeitEingabe = {
  art: "biomasse",
  bezeichnung: "Rindergülle Milchviehbetrieb",
  kontaktperson: "Thomas Müller",
  ort: "Rülzheim",
  koordinate: true,
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2028-12-31",
  menge: 1850,
  tsAnteil: 8,
  aschegehalt: 15,
  mengeEinheit: null,
  preis: 2,
  preisEinheit: null,
  saisonalitaet: [110, 110, 105, 100, 95, 90, 90, 90, 95, 100, 105, 110],
  beleg: {
    typ: "vertrag",
    quellenangabe: "Liefervertrag Nr. 2026-014",
    erhebungsdatum: "2026-03-10",
    externNachvollziehbar: true,
    dateiOderLink: true,
    kernnotiz: null,
  },
  status: "geprueft",
};

describe("vollstaendigkeit", () => {
  it("voll gepflegter Biomassestrom erreicht 100 %", () => {
    expect(vollstaendigkeit(vollerFeed)).toBe(100);
  });

  it("Gleichverteilung zaehlt nicht als gepflegte Saisonalitaet", () => {
    const flach = { ...vollerFeed, saisonalitaet: Array(12).fill(100 / 12) };
    expect(vollstaendigkeit(flach)).toBe(94);
  });

  it("Kernnotiz ist nur beim Gespraech ein Pruefpunkt", () => {
    const gespraech = {
      ...vollerFeed,
      beleg: { ...vollerFeed.beleg!, typ: "gespraech", kernnotiz: null },
    };
    expect(vollstaendigkeit(gespraech)).toBe(94);
    const mitNotiz = {
      ...gespraech,
      beleg: { ...gespraech.beleg, kernnotiz: "Anbau ab 2027 geplant." },
    };
    expect(vollstaendigkeit(mitNotiz)).toBe(100);
  });

  it("Output ohne Beleg und im Entwurf liegt deutlich unter 100 %", () => {
    const output: VollstaendigkeitEingabe = {
      art: "output",
      bezeichnung: "Fernwärmenetz Speyer-Nord",
      kontaktperson: null,
      ort: "Speyer",
      koordinate: false,
      zeitraumVon: "2027-01-01",
      zeitraumBis: "2036-12-31",
      menge: 18000,
      tsAnteil: null,
      aschegehalt: null,
      mengeEinheit: "MWh/a",
      preis: null,
      preisEinheit: null,
      saisonalitaet: Array(12).fill(100 / 12),
      beleg: null,
      status: "entwurf",
    };
    // gefuellt: bezeichnung, ort, von, bis, menge, einheit = 6 von 17 (F7)
    expect(vollstaendigkeit(output)).toBe(35);
  });

  it("fehlende Datei/Link senkt den Erfassungsgrad (F7)", () => {
    const ohne = {
      ...vollerFeed,
      beleg: { ...vollerFeed.beleg!, dateiOderLink: false },
    };
    expect(vollstaendigkeit(ohne)).toBe(94);
  });
});

// F0b: der Landkreis-Pruefpunkt ist durch die Koordinate ersetzt — aus ihr
// folgen Landkreis und Bundesland raeumlich.
describe("vollstaendigkeit — Koordinate statt Landkreis (F0b)", () => {
  it("fehlende Koordinate senkt den Erfassungsgrad", () => {
    const mit = vollstaendigkeit({ ...vollerFeed, koordinate: true });
    const ohne = vollstaendigkeit({ ...vollerFeed, koordinate: false });
    expect(mit).toBeGreaterThan(ohne);
  });
});
