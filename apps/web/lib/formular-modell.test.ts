import { describe, expect, it, vi } from "vitest";

import {
  datumZuMonat,
  formularZeileZuWerte,
  monatZuBis,
  monatZuVon,
  type FormularZeile,
} from "./formular-modell";

const zeile: FormularZeile = {
  id: "b1",
  akteurId: "a1",
  akteurName: "Hof Müller",
  akteurSektor: "landwirtschaft",
  bezeichnung: "Rindergülle",
  ort: "Rülzheim",
  landkreis: "Germersheim",
  kontaktperson: null,
  materialartCode: "rinderguelle",
  cluster: "guelle_mist",
  produktCode: null,
  zeitraumVon: "2026-04-01",
  zeitraumBis: "2028-12-31",
  mengeRohFm: "1200.00",
  tsAnteilPct: "8.5",
  aschegehaltPct: null,
  mengeWert: null,
  mengeEinheit: null,
  preisMin: null,
  preisMittel: "4",
  preisMax: null,
  preis: null,
  preisEinheit: null,
  preisHerkunft: "schaetzung",
  saisonalitaet: [0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 20],
  status: "entwurf",
  belegId: "beleg1",
  belegTyp: "gespraech",
  belegLinkUrl: null,
  belegDateiKey: null,
  belegErstelltAm: new Date("2026-08-01T00:00:00Z"),
  belegGueltigBis: null,
  belegExtern: false,
  belegMetadata: {
    quellenangabe: "Tel. 2026-08-01",
    gespraechsdatum: "2026-08-01",
    gespraechspartner: "T. Müller",
    kernnotiz: "mündlich bestätigt",
  },
};

describe("Monat-Mapping", () => {
  it("Datum → Monat und zurück (von = Monatserster, bis = Monatsletzter)", () => {
    expect(datumZuMonat("2026-04-01")).toBe("2026-04");
    expect(datumZuMonat(null)).toBe("");
    expect(monatZuVon("2026-04")).toBe("2026-04-01");
    expect(monatZuBis("2026-04")).toBe("2026-04-30");
    expect(monatZuBis("2028-02")).toBe("2028-02-29"); // Schaltjahr
    expect(monatZuBis("2026-12")).toBe("2026-12-31");
  });
});

describe("formularZeileZuWerte", () => {
  it("liefert Input-taugliche Strings und die 12 Saisonwerte", () => {
    const w = formularZeileZuWerte("biomasse", zeile);
    expect(w.akteurId).toBe("a1");
    expect(w.vonMonat).toBe("2026-04");
    expect(w.bisMonat).toBe("2028-12");
    expect(w.mengeRohFm).toBe("1200.00");
    expect(w.aschegehaltPct).toBe("");
    expect(w.kontaktperson).toBe("");
    expect(w.saisonalitaet).toHaveLength(12);
    expect(w.beleg?.typ).toBe("gespraech");
    expect(w.beleg?.gespraechspartner).toBe("T. Müller");
    expect(w.beleg?.erhebungsdatum).toBe("2026-08-01");
    expect(w.beleg?.quellenangabe).toBe("Tel. 2026-08-01");
  });

  it("Treiber-Form Zeichenkette: saisonalitaet als JSON-Text wird geparst", () => {
    const w = formularZeileZuWerte("biomasse", {
      ...zeile,
      saisonalitaet: "[0,0,0,10,10,10,10,10,10,10,10,20]",
    });
    expect(w.saisonalitaet[11]).toBe(20);
  });

  it("unerwartetes Saison-Format wird protokolliert, nicht still geleert", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = formularZeileZuWerte("biomasse", { ...zeile, saisonalitaet: "quatsch" });
    expect(w.saisonalitaet).toEqual(Array(12).fill(0));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("ohne Beleg-Typ ist beleg null", () => {
    const w = formularZeileZuWerte("biomasse", { ...zeile, belegTyp: null });
    expect(w.beleg).toBeNull();
  });

  it("Output-Zeile: Produkt- und Preisfelder kommen durch", () => {
    const w = formularZeileZuWerte("output", {
      ...zeile,
      materialartCode: null,
      cluster: null,
      produktCode: "h2_druck",
      mengeRohFm: null,
      mengeWert: "50",
      mengeEinheit: "t/a",
      preis: "12.5",
      preisEinheit: "€/t",
    });
    expect(w.produktCode).toBe("h2_druck");
    expect(w.mengeWert).toBe("50");
    expect(w.preisEinheit).toBe("€/t");
  });
});
