import { describe, expect, it } from "vitest";

import {
  EINSTUFUNGEN,
  EXPORT_SPALTEN,
  KEIN_BELEG,
  ZURUECKGEHALTEN,
  csvDatum,
  csvZahl,
  dateiName,
  erzeugeCsv,
  exportDateiname,
  exportModus,
  exportZeile,
  metazeilen,
  parseCsv,
  type ExportKontext,
  exportZellen,
  zelleDruck,
} from "./export-modell";
import type { Strom } from "./stroeme-modell";

const strom = (patch: Partial<Strom>): Strom =>
  ({
    id: "s",
    art: "biomasse",
    akteurId: "a",
    akteurName: "Hof Muster",
    sektor: "landwirtschaft",
    sektorLabel: "Landwirtschaft",
    bezeichnung: "Gülle",
    kontaktperson: null,
    ort: "Rülzheim",
    regionIds: [],
    regionNamen: [],
    verwaltung: { kreisArs: "07334", kreisName: "Germersheim", kreisBez: "Landkreis", landArs: "07", landName: "Rheinland-Pfalz" },
    lat: 49.1,
    lng: 8.3,
    cluster: "guelle_mist",
    materialartCode: "rinderguelle",
    materialartLabel: "Rindergülle",
    mengeFm: 1200,
    tsAnteil: 8.5,
    aschegehalt: 15,
    mengeAtro: 86.7,
    preisMin: -12,
    preisMittel: -5,
    preisMax: 3,
    preisHerkunft: "schaetzung",
    gruppe: null,
    gruppeLabel: null,
    produktCode: null,
    produktLabel: null,
    kategorie: null,
    mengeWert: null,
    mengeEinheit: null,
    preis: null,
    preisEinheit: null,
    zeitraumVon: "2026-04-01",
    zeitraumBis: "2028-12-31",
    saisonalitaet: null,
    qualitaet: "B",
    status: "geprueft",
    reserviertBhyo: false,
    reserviertSeit: null,
    erstelltAm: "2026-01-01",
    vollstaendigkeit: 80,
    beleg: null,
    ...patch,
  }) as Strom;

// Ein NICHT freigegebener Beleg mit allen vier Belegangaben …
const GEHEIM = {
  nr: "B-000777",
  quelle: "Liefervertrag Nr. 2026-014, S. 3",
  datei: "vertrag-geheim.pdf",
  link: "https://intern.example/vertrag",
};
const nichtFreigegeben = strom({
  id: "geheim",
  beleg: {
    id: "b1",
    nr: GEHEIM.nr,
    typ: "vertrag",
    quellenangabe: GEHEIM.quelle,
    href: `/api/belege/belege/preview/3f2a91c4-0000-4000-8000-000000000001-${GEHEIM.datei}`,
    externNachvollziehbar: false,
    gueltigBis: "2027-12-31",
    erhebungsdatum: "2026-01-15",
    kernnotiz: null,
  },
  // … und eine externe Vergabe mit Abnehmernamen.
  vergaben: [
    { vergebenVon: "2026-01-01", vergebenBis: "2027-06-30", vergebenAn: "Biogas Nachbar GmbH", anBhyo: false },
    { vergebenVon: "2027-07-01", vergebenBis: null, vergebenAn: null, anBhyo: true },
  ],
  verifikation: { faelligkeit: "2027-06-30", status: "aktiv" },
});
const linkBeleg = strom({
  id: "link",
  beleg: { ...nichtFreigegeben.beleg!, href: GEHEIM.link, externNachvollziehbar: false },
});
// Ein freigegebener Beleg mit EIGENEN Werten — sonst stünden die geheimen
// Werte zu Recht in der Datei und der Test könnte nichts beweisen.
const FREI = { nr: "B-000778", quelle: "Öffentlicher Bericht 2026", datei: "bericht-2026.pdf" };
const freigegeben = strom({
  id: "frei",
  beleg: {
    ...nichtFreigegeben.beleg!,
    nr: FREI.nr,
    quellenangabe: FREI.quelle,
    href: `/api/belege/belege/preview/3f2a91c4-0000-4000-8000-000000000002-${FREI.datei}`,
    externNachvollziehbar: true,
  },
  vergaben: nichtFreigegeben.vergaben,
});
const ohneBeleg = strom({ id: "ohne", beleg: null });

const kontext: ExportKontext = {
  modus: "extern",
  stand: "26.09.2026, 12:00 Uhr",
  ansicht: "ströme. · Feedstock",
  bezugsjahr: 2026,
  aktiveFilter: ["Verfügbarkeit: verfügbar"],
  nichtAngewandt: [],
};

describe("Exportmodell: Einstufung ist Pflicht", () => {
  it("jede Spalte trägt genau eine der drei Einstufungen — eine neue ohne Einstufung schlägt hier fehl", () => {
    const ohne = EXPORT_SPALTEN.filter((sp) => !EINSTUFUNGEN.includes(sp.einstufung));
    expect(ohne.map((sp) => sp.key)).toEqual([]);
    // Schlüssel eindeutig, Köpfe eindeutig.
    expect(new Set(EXPORT_SPALTEN.map((sp) => sp.key)).size).toBe(EXPORT_SPALTEN.length);
    expect(new Set(EXPORT_SPALTEN.map((sp) => sp.kopf)).size).toBe(EXPORT_SPALTEN.length);
  });

  it("die vier Belegangaben sind als solche eingestuft, die Vergaben als gekürzt", () => {
    const nach = (e: string) => EXPORT_SPALTEN.filter((sp) => sp.einstufung === e).map((sp) => sp.key);
    expect(nach("belegangabe")).toEqual(["belegnummer", "quellenangabe", "datei", "link"]);
    expect(nach("gekuerzt")).toEqual(["vergaben"]);
    for (const sp of EXPORT_SPALTEN) if (sp.einstufung === "gekuerzt") expect(sp.wertExtern).toBeTypeOf("function");
  });

  it("Spaltenreihenfolge: Identität → Ort → Einordnung → Zeitraum → Mengen → Preise → Potenzial → Nachweis → Markt", () => {
    expect(EXPORT_SPALTEN.map((sp) => sp.key)).toEqual([
      "art", "belegnummer", "bezeichnung", "akteur", "sektor",
      "ort", "landkreis", "bundesland",
      "cluster_gruppe", "materialart_produkt",
      "zeitraum_von", "zeitraum_bis",
      "menge_atro", "menge_stofflich", "menge_energetisch",
      "preis_min", "preis_mittel", "preis_max", "preis_stofflich", "preis_energetisch",
      "potenzial",
      "qualitaet", "belegtyp", "quellenangabe", "datei", "link", "verifikation", "faelligkeit",
      "status", "verfuegbarkeit", "reserviert", "reserviert_seit", "vergaben",
    ]);
  });

  it("jeder Kopf mit Zahlen nennt die Einheit; Preise und Potenzial nennen die Vorzeichenrichtung", () => {
    for (const key of ["menge_atro", "menge_stofflich", "menge_energetisch", "preis_min", "preis_mittel", "preis_max", "preis_stofflich", "preis_energetisch", "potenzial"]) {
      expect(EXPORT_SPALTEN.find((sp) => sp.key === key)!.kopf).toMatch(/\[[^\]]+\]/);
    }
    for (const key of ["preis_min", "preis_mittel", "preis_max", "potenzial"]) {
      expect(EXPORT_SPALTEN.find((sp) => sp.key === key)!.kopf).toMatch(/positiv = (Kosten|Erlös) für bhyo/);
    }
  });
});

describe("Externe Datei: nichts Zurückgehaltenes kommt vor", () => {
  it("erzeugt eine echte externe CSV, liest sie ein — keine der vier Belegangaben, kein Abnehmername", () => {
    const csv = erzeugeCsv([nichtFreigegeben, linkBeleg, freigegeben, ohneBeleg], kontext);
    for (const wert of Object.values(GEHEIM)) expect(csv).not.toContain(wert);
    expect(csv).not.toContain("Biogas Nachbar GmbH");

    const zeilen = parseCsv(csv);
    const kopf = zeilen.find((z) => z[0] === "Art")!;
    const spalte = (name: string) => kopf.indexOf(name);
    const geheimZeile = zeilen.filter((z) => z.length === kopf.length && z[0] === "Feedstock")[0]!;
    for (const name of ["Belegnummer", "Quellenangabe", "Datei", "Link"]) {
      expect(geheimZeile[spalte(name)]).toBe(ZURUECKGEHALTEN);
    }
    expect(geheimZeile[spalte("Vergaben")]).toBe("01/2026 – 06/2027 extern vergeben | ab 07/2027 (unbefristet) an bhyo");
    // Mengen und Preise gehen hinaus — einzeln wie in Summen.
    expect(geheimZeile[spalte("Menge [t atro/a]")]).toBe("87");
    expect(geheimZeile[spalte("Preis mittel [€/t atro] (positiv = Kosten für bhyo)")]).toBe("-5");
    expect(geheimZeile[spalte("Potenzial [€/a] (positiv = Erlös für bhyo)")]).toBe("434");
    // Freigegeben: alles da; ohne Beleg: benannter Zustand, nicht „zurückgehalten".
    const freiZeile = zeilen.filter((z) => z.length === kopf.length && z[0] === "Feedstock")[2]!;
    expect(freiZeile[spalte("Belegnummer")]).toBe(FREI.nr);
    expect(freiZeile[spalte("Datei")]).toBe(FREI.datei);
    const ohneZeile = zeilen.filter((z) => z.length === kopf.length && z[0] === "Feedstock")[3]!;
    expect(ohneZeile[spalte("Quellenangabe")]).toBe(KEIN_BELEG);
  });

  it("intern steht alles, und die Datei sagt es in der Metazeile", () => {
    const csv = erzeugeCsv([nichtFreigegeben, linkBeleg], { ...kontext, modus: "intern" });
    for (const wert of Object.values(GEHEIM)) expect(csv).toContain(wert);
    expect(csv).toContain("Biogas Nachbar GmbH");
    expect(csv).toContain("intern: enthält vertrauliche Angaben, nicht weitergeben");
  });

  it("nie eine leere Zelle — jede Zelle trägt Zahl oder benannten Zustand", () => {
    const csv = erzeugeCsv([nichtFreigegeben, ohneBeleg, strom({ id: "out", art: "output", produktCode: "h2_hochdruck", produktLabel: "H2", gruppeLabel: "Wasserstoff", mengeWert: null, preis: null })], kontext);
    const zeilen = parseCsv(csv);
    const kopf = zeilen.find((z) => z[0] === "Art")!;
    for (const z of zeilen.filter((z) => z.length === kopf.length && z[0] !== "Art")) {
      for (const zelle of z) expect(zelle.trim().length, JSON.stringify(z)).toBeGreaterThan(0);
    }
  });

  it("Datei nur als Dateiname — nie Speicherschlüssel, nie URL auf die Ablage", () => {
    const csv = erzeugeCsv([freigegeben], { ...kontext, modus: "intern" });
    expect(csv).not.toContain("/api/belege/");
    expect(csv).not.toContain("belege/preview/");
    expect(dateiName("belege/preview/3f2a91c4-0000-4000-8000-000000000001-Vertrag_2026.pdf")).toBe("Vertrag_2026.pdf");
  });
});

describe("Format für deutsches Excel", () => {
  it("Semikolon, CRLF, BOM, Komma als Dezimaltrenner, Datum TT.MM.JJJJ", () => {
    const csv = erzeugeCsv([nichtFreigegeben], kontext);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"Art";"Belegnummer"');
    expect(csvZahl(1234.5, 1)).toBe("1234,5");
    expect(csvZahl(86.7)).toBe("87");
    expect(csvZahl(-0.2)).toBe("0");
    expect(csvDatum("2028-12-31")).toBe("31.12.2028");
    expect(csvDatum(null)).toBeNull();
    const zeile = parseCsv(csv).find((z) => z[0] === "Feedstock")!;
    expect(zeile).toContain("01.04.2026");
  });

  it("Metazeilen: Modus, Stand, Ansicht, Bezugsjahr, aktive und nicht angewandte Filter, BKG-Vermerk", () => {
    const m = metazeilen({ ...kontext, nichtAngewandt: ["Freitext: Speyer"] }).map((z) => z[0]);
    expect(m).toEqual(["Modus", "Stand", "Ansicht", "Bezugsjahr", "Aktive Filter", "Nicht angewandte Filter", "Quellenvermerk"]);
    const csv = erzeugeCsv([], kontext);
    expect(csv).toContain("extern: nicht freigegebene Belegangaben und Abnehmernamen zurückgehalten");
    expect(csv).toContain("© GeoBasis-DE / BKG (2026), dl-de/by-2-0");
  });

  it("Dateiname trägt Sicht, Modus und Datum; Modus ist extern, wenn nichts gewählt", () => {
    expect(exportDateiname("feedstock", "extern", "2026-09-26T10:00:00Z")).toBe("markt-feedstock-extern-2026-09-26.csv");
    expect(exportModus(null)).toBe("extern");
    expect(exportModus("alles")).toBe("extern");
    expect(exportModus("intern")).toBe("intern");
  });

  it("Zustände: entfällt bei fremder Stromart, kein Energieäquivalent bei CO2", () => {
    const co2 = strom({ id: "co2", art: "output", produktCode: "co2", produktLabel: "CO₂", gruppeLabel: "Add-Ons", mengeWert: 500, mengeEinheit: "t/a", preis: 40, preisEinheit: "€/t" });
    const z = exportZeile(co2, "intern");
    const idx = (key: string) => EXPORT_SPALTEN.findIndex((sp) => sp.key === key);
    expect(z[idx("menge_atro")]).toBe("entfällt");
    expect(z[idx("menge_stofflich")]).toBe("500");
    expect(z[idx("menge_energetisch")]).toBe("kein Energieäquivalent");
    expect(z[idx("preis_energetisch")]).toBe("kein Energieäquivalent");
    expect(z[idx("potenzial")]).toBe("20000");
  });
});

// F6 PR B: Der Druck liest dieselben Zellen — nur die Zahl wird anders formatiert.
describe("Druck: dieselben Zellen, Formatierung aus lib/format.ts", () => {
  it("hält extern dieselben Angaben zurück wie die CSV", () => {
    const zellen = exportZellen(nichtFreigegeben, "extern").map(zelleDruck);
    const idx = (key: string) => EXPORT_SPALTEN.findIndex((sp) => sp.key === key);
    for (const key of ["belegnummer", "quellenangabe", "datei", "link"]) expect(zellen[idx(key)]).toBe(ZURUECKGEHALTEN);
    expect(zellen[idx("vergaben")]).not.toContain("Biogas Nachbar GmbH");
    expect(exportZellen(nichtFreigegeben, "intern").map(zelleDruck)[idx("quellenangabe")]).toBe(GEHEIM.quelle);
  });

  it("Zahlen im Druck mit Tausenderpunkt (E20), in der CSV ohne — dieselbe Zelle", () => {
    const gross = strom({ id: "g", mengeAtro: 12345.6, preisMittel: -1234.4 });
    const idx = (key: string) => EXPORT_SPALTEN.findIndex((sp) => sp.key === key);
    const zellen = exportZellen(gross, "intern");
    expect(zelleDruck(zellen[idx("menge_atro")]!)).toBe("12.346");
    expect(exportZeile(gross, "intern")[idx("menge_atro")]).toBe("12346");
    expect(zelleDruck(zellen[idx("preis_mittel")]!)).toBe("-1.234");
    expect(zelleDruck("entfällt")).toBe("entfällt");
  });
});
