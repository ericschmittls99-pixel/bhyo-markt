/**
 * AP2.7 PR b (E67): Zuordnung — Vorschlag aus der Kopfzeile, Personen-
 * Erkennung, Pflichtfeld-Pruefung, Einheiten (nur t/kg je Jahr/Monat),
 * Werte → Codes, Zeile → Felder ohne jeden Personen-Inhalt.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseImportDatei } from "./import-datei";
import { IGNORIEREN, PERSON, einheitFaktor, monatAusText, pruefeVorlage, pruefeZuordnung, spaltenWerte, vorlageAnwenden, vorschlagZuordnung, werteVorschlag, zeileZuFelder, type Zuordnung } from "./import-zuordnung";

const fixture = (() => {
  const b = readFileSync(join(__dirname, "..", "..", "..", "docs", "beispiele", "import-biomasse.csv"));
  return parseImportDatei(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, "import-biomasse.csv");
})();

describe("vorschlagZuordnung", () => {
  it("ordnet die Kopfzeile der Beispiel-CSV zu und markiert Personen-Spalten", () => {
    expect(vorschlagZuordnung("biomasse", fixture.spalten)).toEqual({
      Betrieb: "akteur_name",
      Sektor: "akteur_sektor",
      Straße: "akteur_sitz_strasse",
      Hausnummer: "akteur_sitz_hausnummer",
      PLZ: "akteur_sitz_plz",
      Ort: "akteur_sitz_ort",
      Ansprechpartner: PERSON,
      "E-Mail": PERSON,
      Materialart: "materialart_code",
      Menge: "menge_roh_fm",
      Einheit: "menge_einheit_fm",
      "TS-Anteil %": "ts_anteil_pct",
      "Zeitraum von": "zeitraum_von",
      "Zeitraum bis": "zeitraum_bis",
    });
  });

  it("vergibt ein Zielfeld nur einmal, kennt die Art und laesst Unbekanntes leer", () => {
    expect(vorschlagZuordnung("output", ["Produkt", "Menge", "Einheit", "Produkt (2)", "Farbe", "Telefon"])).toEqual({
      Produkt: "produkt_code",
      Menge: "menge_wert",
      Einheit: "menge_einheit",
      "Produkt (2)": "",
      Farbe: "",
      Telefon: PERSON,
    });
    expect(vorschlagZuordnung("output", ["Materialart"])).toEqual({ Materialart: "" });
  });
});

describe("pruefeZuordnung", () => {
  const basis = (): Zuordnung => ({ spalten: vorschlagZuordnung("biomasse", fixture.spalten), werte: {} });

  it("nennt fehlende Pflichtfelder (die Fixture hat keinen Aschegehalt)", () => {
    const f = pruefeZuordnung("biomasse", fixture.spalten, basis());
    expect(f).toEqual([expect.stringMatching(/Pflichtfelder ohne Spalte: Aschegehalt %/)]);
  });

  it("weist doppelte Zielfelder, Personen-Ziele und fremde Zielfelder ab", () => {
    const z = basis();
    z.spalten["Zeitraum bis"] = "zeitraum_von";
    z.spalten["Ansprechpartner"] = "email";
    z.spalten["Sektor"] = "produkt_code";
    const f = pruefeZuordnung("biomasse", fixture.spalten, z);
    expect(f.some((m) => /doppelt zugeordnet/.test(m))).toBe(true);
    expect(f.some((m) => /Personen-Daten werden nicht übernommen/.test(m))).toBe(true);
    expect(f.some((m) => /unbekanntes Zielfeld „produkt_code"/.test(m))).toBe(true);
  });

  it("ist leer, wenn alle Pflichtfelder einmal belegt sind", () => {
    const z = basis();
    z.spalten["Hausnummer"] = "aschegehalt_pct";
    expect(pruefeZuordnung("biomasse", fixture.spalten, z)).toEqual([]);
  });
});

describe("einheitFaktor (E67: nur t/kg je Jahr/Monat, TM ist Fehler)", () => {
  it.each([
    ["", 1],
    ["t/a", 1],
    ["t FM/a", 1],
    ["Tonnen pro Jahr", 1],
    ["kg/a", 0.001],
    ["t/Monat", 12],
    ["kg / Monat", 0.012],
    ["t p.a.", 1],
  ])("„%s“ → Faktor %s", (text, faktor) => {
    expect(einheitFaktor(text)).toEqual({ faktor });
  });
  it.each(["t TM/a", "t atro", "m³/a", "Stück", "kg TS"])("„%s“ ist ein Zeilenfehler", (text) => {
    const e = einheitFaktor(text);
    expect("fehler" in e).toBe(true);
  });
});

describe("zeileZuFelder", () => {
  const z: Zuordnung = {
    spalten: { ...vorschlagZuordnung("biomasse", fixture.spalten), Hausnummer: "aschegehalt_pct" },
    werte: {
      materialart_code: { Rindergülle: "guelle_rind", Maissilage: "maissilage" },
      akteur_sektor: { Landwirtschaft: "landwirtschaft" },
    },
  };

  it("uebernimmt nur zugeordnete Zielfelder; kein Personen-Inhalt verlaesst die Funktion", () => {
    const r = zeileZuFelder(fixture.spalten, fixture.zeilen[0]!, z);
    expect(r.fehlergrund).toBeNull();
    expect(r.felder).toEqual({
      akteur_name: "Hof Mustermann",
      akteur_sektor: "landwirtschaft",
      akteur_sitz_strasse: "Dorfstraße",
      aschegehalt_pct: "3",
      akteur_sitz_plz: "67346",
      akteur_sitz_ort: "Speyer",
      materialart_code: "guelle_rind",
      menge_roh_fm: "1.234,5",
      ts_anteil_pct: "8,5",
      zeitraum_von: "2026-01",
      zeitraum_bis: "2026-12",
    });
    expect(JSON.stringify(r)).not.toMatch(/Max Mustermann|example\.invalid|Ansprech|E-Mail/);
  });

  it("nicht zugeordneter Code-Wert ist ein Zeilenfehler, leerer Code bleibt leer (Standard folgt spaeter)", () => {
    const r = zeileZuFelder(fixture.spalten, fixture.zeilen[2]!, z);
    expect(r.fehlergrund).toBe("Materialart: Wert „Festmist\" ist keinem Code zugeordnet.");
    const r2 = zeileZuFelder(fixture.spalten, fixture.zeilen[1]!, z);
    expect(r2.fehlergrund).toBeNull();
    expect(r2.felder.akteur_sektor).toBe("");
  });

  it("rechnet die Menge ueber die Einheitenspalte in t FM/a um, volle Praezision, Komma als Trenner", () => {
    const zeile = [...fixture.zeilen[1]!];
    zeile[9] = "2500";
    zeile[10] = "kg/Monat";
    expect(zeileZuFelder(fixture.spalten, zeile, z).felder.menge_roh_fm).toBe("30");
    zeile[9] = "1.234,5";
    zeile[10] = "t/Monat";
    expect(zeileZuFelder(fixture.spalten, zeile, z).felder.menge_roh_fm).toBe("14814");
    zeile[10] = "t TM/a";
    expect(zeileZuFelder(fixture.spalten, zeile, z).fehlergrund).toMatch(/Trockenmasse/);
  });

  it("Monate: MM/JJJJ, Datumszelle und Rohtext", () => {
    expect(monatAusText("01/2026")).toBe("2026-01");
    expect(monatAusText("2026-03-15")).toBe("2026-03");
    expect(monatAusText("Frühjahr")).toBe("Frühjahr");
  });

  it("ignorierte und Personen-Spalten fallen weg, auch wenn der Mensch sie umbenennt", () => {
    const z2: Zuordnung = { spalten: { ...z.spalten, Ansprechpartner: IGNORIEREN, "E-Mail": "kontakt_email" }, werte: z.werte };
    const r = zeileZuFelder(fixture.spalten, fixture.zeilen[0]!, z2);
    expect(Object.keys(r.felder)).not.toContain("kontakt_email");
    expect(JSON.stringify(r.felder)).not.toMatch(/example\.invalid/);
  });
});

describe("Werte-Zuordnung", () => {
  it("spaltenWerte zaehlt verschiedene Werte, haeufigste zuerst", () => {
    expect(spaltenWerte(fixture.zeilen, 8)).toEqual([
      { wert: "Festmist", anzahl: 1 },
      { wert: "Maissilage", anzahl: 1 },
      { wert: "Rindergülle", anzahl: 1 },
    ]);
    expect(spaltenWerte(fixture.zeilen, 0)[0]).toEqual({ wert: "Hof Mustermann", anzahl: 2 });
    expect(spaltenWerte(fixture.zeilen, 1)).toEqual([{ wert: "Landwirtschaft", anzahl: 2 }]);
  });

  it("werteVorschlag trifft ueber Label oder Code in Normalform, sonst leer", () => {
    const optionen = [{ code: "guelle_rind", label: "Rindergülle" }, { code: "maissilage", label: "Maissilage" }];
    expect(werteVorschlag(["Rindergülle", "RINDERGUELLE", "maissilage", "Festmist"], optionen)).toEqual({
      Rindergülle: "guelle_rind",
      RINDERGUELLE: "guelle_rind",
      maissilage: "maissilage",
      Festmist: "",
    });
  });
});

describe("Vorlagen", () => {
  it("pruefeVorlage weist Personen-Ziele, unbekannte Ziele und Werte fuer Nicht-Code-Felder ab", () => {
    expect(pruefeVorlage({ spalten: { Betrieb: "akteur_name", Telefon: PERSON, Nr: IGNORIEREN, Rest: "" }, werte: { materialart_code: {} } })).toEqual([]);
    const f = pruefeVorlage({ spalten: { Mail: "email", X: "irgendwas" }, werte: { menge_roh_fm: { a: "b" } } });
    expect(f).toHaveLength(3);
    expect(f[0]).toMatch(/Personen-Daten/);
    expect(f[1]).toMatch(/unbekanntes Zielfeld „irgendwas"/);
    expect(f[2]).toMatch(/kein Code-Zielfeld/);
  });

  it("vorlageAnwenden: Vorlagen-Ziel nach Spaltenname (Normalform), Personen bleiben erkannt, Rest aus dem Vorschlag, Werte ueberdeckt", () => {
    const spalten = ["Betrieb", "Material", "E-Mail", "Menge", "Bemerkung"];
    const vorschlag = vorschlagZuordnung("biomasse", spalten);
    expect(vorschlag).toMatchObject({ Betrieb: "akteur_name", Material: "materialart_code", "E-Mail": PERSON, Menge: "menge_roh_fm", Bemerkung: "bezeichnung" });
    const vorlage: Zuordnung = {
      spalten: { betrieb: "bezeichnung", MATERIAL: "materialart_code", Bemerkung: IGNORIEREN, "E-Mail": "akteur_name" },
      werte: { materialart_code: { Gülle: "guelle_rind", Fremd: "x" } },
    };
    const erg = vorlageAnwenden(vorlage, spalten, vorschlag, { materialart_code: { Gülle: "", Mais: "maissilage" } });
    // Betrieb → bezeichnung (Vorlage), Material → materialart_code (Vorlage), E-Mail bleibt PERSON trotz Vorlage,
    // Menge aus dem Vorschlag (Vorlage kennt sie nicht), Bemerkung ignoriert (Vorlage).
    expect(erg.spalten).toEqual({ Betrieb: "bezeichnung", Material: "materialart_code", "E-Mail": PERSON, Menge: "menge_roh_fm", Bemerkung: IGNORIEREN });
    expect(erg.werte).toEqual({ materialart_code: { Gülle: "guelle_rind", Mais: "maissilage" } });
  });
});
