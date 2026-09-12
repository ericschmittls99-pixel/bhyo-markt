import { describe, expect, it, vi } from "vitest";

import {
  clusterVonMaterialart,
  datumZuMonat,
  formularZeileZuWerte,
  gleichverteilung,
  gruppeVonProdukt,
  materialartenImCluster,
  monatZuBis,
  monatZuVon,
  produkteInGruppe,
  saisonWertSetzen,
  validiereFormular,
  type FormularEingaben,
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

const eingabenOk: FormularEingaben = {
  akteurId: "a1",
  materialartCode: "x",
  produktCode: "",
  mengeRohFm: "100",
  tsAnteilPct: "50",
  aschegehaltPct: "3",
  mengeWert: "",
  mengeEinheit: "",
  preisMin: "",
  preisMittel: "",
  preisMax: "",
  preis: "",
  vonMonat: "2026-01",
  bisMonat: "2026-12",
  begruendung: "Ersterfassung",
  belegTyp: "",
  belegQuellenangabe: "",
  belegErhebungsdatum: "",
  belegHatDatei: false,
  belegLink: "",
};

describe("validiereFormular biomasse", () => {
  it("gültig → keine Fehler", () => {
    expect(validiereFormular("biomasse", eingabenOk)).toEqual({});
  });
  it("Pflichtfelder fehlen → benannte Fehler", () => {
    const f = validiereFormular("biomasse", { ...eingabenOk, akteurId: "", begruendung: " " });
    expect(f.akteur_id).toBe("Pflichtfeld");
    expect(f.begruendung).toBe("Pflichtfeld");
  });
  it("Zahlenfeld mit Text → Fehler", () => {
    const f = validiereFormular("biomasse", { ...eingabenOk, mengeRohFm: "viel" });
    expect(f.menge_roh_fm).toBe("Muss eine Zahl sein");
  });
  it("Beleg gewählt → Quellenangabe/Erhebungsdatum Pflicht, Datei ODER Link", () => {
    const f = validiereFormular("biomasse", { ...eingabenOk, belegTyp: "dokument_link" });
    expect(f.beleg_quellenangabe).toBe("Pflichtfeld");
    expect(f.beleg_erhebungsdatum).toBe("Pflichtfeld");
    expect(f.beleg_datei).toBe("Datei oder Link erforderlich");
  });
  it("Beleg mit Link statt Datei → kein Datei-Fehler", () => {
    const f = validiereFormular("biomasse", {
      ...eingabenOk,
      belegTyp: "dokument_link",
      belegQuellenangabe: "Bericht 2026",
      belegErhebungsdatum: "2026-05-01",
      belegLink: "https://example.org/x",
    });
    expect(f).toEqual({});
  });
  it("bis vor von → Fehler am Bis-Feld", () => {
    const f = validiereFormular("biomasse", { ...eingabenOk, vonMonat: "2027-01", bisMonat: "2026-01" });
    expect(f.zeitraum_bis).toBe("Bis-Monat liegt vor dem Ab-Monat");
  });
});

describe("validiereFormular output", () => {
  const outputOk: FormularEingaben = {
    ...eingabenOk,
    materialartCode: "",
    mengeRohFm: "",
    tsAnteilPct: "",
    aschegehaltPct: "",
    produktCode: "h2_druck",
    mengeWert: "50",
    mengeEinheit: "t/a",
  };
  it("gültig → keine Fehler", () => {
    expect(validiereFormular("output", outputOk)).toEqual({});
  });
  it("Produkt und Menge Pflicht, Biomasse-Felder egal", () => {
    const f = validiereFormular("output", { ...outputOk, produktCode: "", mengeWert: "" });
    expect(f.produkt_code).toBe("Pflichtfeld");
    expect(f.menge_wert).toBe("Pflichtfeld");
    expect(f.menge_roh_fm).toBeUndefined();
  });
});

describe("Kopplung Cluster→Materialart / Gruppe→Produkt", () => {
  const arten = [
    { code: "a", label: "A", cluster: "c1" },
    { code: "b", label: "B", cluster: "c2" },
  ];
  const produkte = [
    { code: "p1", label: "P1", gruppe: "g1", kategorie: "target" },
    { code: "p2", label: "P2", gruppe: "g2", kategorie: "add_on" },
  ];
  it("filtert und findet rückwärts", () => {
    expect(materialartenImCluster(arten, "c1").map((m) => m.code)).toEqual(["a"]);
    expect(materialartenImCluster(arten, "").map((m) => m.code)).toEqual(["a", "b"]);
    expect(clusterVonMaterialart(arten, "b")).toBe("c2");
    expect(clusterVonMaterialart(arten, "fehlt")).toBe("");
    expect(produkteInGruppe(produkte, "g2").map((p) => p.code)).toEqual(["p2"]);
    expect(gruppeVonProdukt(produkte, "p1")).toBe("g1");
  });
});

describe("Saison-Helfer", () => {
  it("gleichverteilung: 12 gleiche Werte, Summe nahe 100", () => {
    const g = gleichverteilung();
    expect(g).toHaveLength(12);
    expect(new Set(g).size).toBe(1);
    expect(g.reduce((a, b) => a + b, 0)).toBeGreaterThan(99);
    expect(g.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100.8);
  });
  it("saisonWertSetzen clampt 0–100, rundet und lässt Nachbarn stehen", () => {
    const w = Array(12).fill(5);
    const neu = saisonWertSetzen(w, 3, 104.6);
    expect(neu[3]).toBe(100);
    expect(neu[2]).toBe(5);
    expect(saisonWertSetzen(w, 0, -2)[0]).toBe(0);
    expect(saisonWertSetzen(w, 1, 33.4)[1]).toBe(33);
    expect(w[3]).toBe(5); // Eingabe unveraendert
  });
});
