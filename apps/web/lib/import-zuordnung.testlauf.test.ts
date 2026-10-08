/**
 * AP2.7 PR f (E67): Korrekturen aus dem Testlauf mit docs/beispiele/import-
 * testdatei-ap27.xlsx (Eric 07.10.2026). Die Datei ist die Referenz: jede
 * Zeile ist ein Testfall (Blatt „Testfälle“). Geprueft werden die reinen
 * Regeln — B3 (Zuordnungsfehler bleiben an der Zeile), B4 („t“ ohne
 * Zeitbezug), B5 (Kontaktdaten im Text), B6 (Synonyme, „Nr“), B8 (deutsche
 * Textzahlen, Rundung E20), Datum JJJJ-MM, Einheiten bei Bedarfen, Doppelzeilen.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ortPasst } from "@bhyo/db/plz";

import { brauchtPlzAusOrt, ortGruppen } from "./import-adressen";
import { parseImportDatei } from "./import-datei";
import { FEHLER_PREFIX, HINWEIS_PREFIX, IGNORIEREN, PERSON, bereinigteCsv, datumAusText, einheitFaktor, einheitOutput, enthaeltKontaktdaten, findeDoppelzeilen, hinweise, monatAusText, preisBezugVorschlag, vorschlagZuordnung, zahlAusText, zeileZuFelder, zuordnungsFehler, type Zuordnung } from "./import-zuordnung";

const bytes = (() => {
  const b = readFileSync(join(__dirname, "..", "..", "..", "docs", "beispiele", "import-testdatei-ap27.xlsx"));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
})();
const biomasse = parseImportDatei(bytes, "import-testdatei-ap27.xlsx", { blatt: "Erhebung Biomasse" });
const bedarfe = parseImportDatei(bytes, "import-testdatei-ap27.xlsx", { blatt: "Bedarfe" });
const zeile = (t: typeof biomasse, nr: number) => t.zeilen[t.zeilennummern.indexOf(nr)]!;

const zBiomasse: Zuordnung = {
  spalten: vorschlagZuordnung("biomasse", biomasse.spalten),
  werte: {
    materialart_code: Object.fromEntries(["Rindergülle", "Maissilage", "Grassilage", "Grünschnitt", "Laub", "Sägespäne", "Waldrestholz", "Altholz A1", "Pferdemist", "Klärschlamm", "Trester", "Stroh", "Rindermist", "Gemüsereste", "Bioabfall", "Rebschnitt", "Hackschnitzel", "Treber", "Speisereste", "Rübenschnitzel", "Spelzen", "Holzhackschnitzel", "Straßenbegleitgrün", "Hühnertrockenkot"].map((w) => [w, w.toLowerCase().replace(/[^a-z0-9]+/g, "_")])),
    akteur_sektor: { Landwirtschaft: "landwirtschaft", Energie: "energie", Kommune: "kommune", Forst: "forst", Abfall: "abfall", Lebensmittelindustrie: "lebensmittel" },
    beleg_typ: { Gespräch: "gespraech", Angebot: "angebot" },
  },
};
const zBedarfe: Zuordnung = {
  spalten: vorschlagZuordnung("output", bedarfe.spalten),
  werte: {
    produkt_code: { Wärme: "waerme", CO2: "co2", Wasserstoff: "h2" },
    akteur_sektor: { Industrie: "industrie", Landwirtschaft: "landwirtschaft", Energie: "energie", Gastronomie: "gastronomie", Verkehr: "verkehr", Logistik: "logistik" },
  },
};

describe("B6: Spalten-Zuordnung der Testdatei", () => {
  it("Blatt „Erhebung Biomasse“: Kopfzeile 4, jede Spalte bekommt ihr Ziel; „Nr“ allein ist die laufende Nummer", () => {
    expect(biomasse.kopfzeile).toBe(4);
    expect(zBiomasse.spalten).toEqual({
      Nr: IGNORIEREN,
      "Betrieb / Firma": "akteur_name",
      Straße: "akteur_sitz_strasse",
      "Hausnr.": "akteur_sitz_hausnummer",
      PLZ: "akteur_sitz_plz",
      Ort: "akteur_sitz_ort",
      Branche: "akteur_sektor",
      Material: "materialart_code",
      Menge: "menge_roh_fm",
      Einheit: "menge_einheit_fm",
      "verfügbar ab": "zeitraum_von",
      "verfügbar bis": "zeitraum_bis",
      "Preis €/t": "preis_mittel",
      Quelle: "beleg_typ",
      Stand: "beleg_erhebungsdatum",
      "gültig bis": "beleg_gueltig_bis",
      Ansprechpartner: PERSON,
      Telefon: PERSON,
      "E-Mail": PERSON,
      Bemerkung: "bezeichnung",
    });
  });
  it("Blatt „Bedarfe“: „Nr“ direkt nach „Straße“ ist die Hausnummer, „Bedarf“ die Menge, „Kontakt“ eine Person", () => {
    expect(zBedarfe.spalten).toEqual({
      Abnehmer: "akteur_name",
      Straße: "akteur_sitz_strasse",
      Nr: "akteur_sitz_hausnummer",
      PLZ: "akteur_sitz_plz",
      Ort: "akteur_sitz_ort",
      Branche: "akteur_sektor",
      Produkt: "produkt_code",
      Bedarf: "menge_wert",
      Einheit: "menge_einheit",
      ab: "zeitraum_von",
      Kontakt: PERSON,
      Bemerkung: "bezeichnung",
    });
  });
  it("Hausnummer nur zusammen mit Straße; weitere Synonyme", () => {
    expect(vorschlagZuordnung("biomasse", ["Hausnummer", "Name"])).toEqual({ Hausnummer: "", Name: "akteur_name" });
    expect(vorschlagZuordnung("biomasse", ["Nr", "Firma", "Menge t/a", "Unternehmen"])).toEqual({ Nr: IGNORIEREN, Firma: "akteur_name", "Menge t/a": "menge_roh_fm", Unternehmen: "" });
    expect(vorschlagZuordnung("output", ["Bedarfsmenge", "Bedarf"])).toEqual({ Bedarfsmenge: "menge_wert", Bedarf: "" });
  });
});

describe("B4/B8: Einheiten und Zahlen", () => {
  it("„t“ und „kg“ ohne Zeitbezug sind mehrdeutig (Leitregel) — leer heisst weiter t/a", () => {
    expect(einheitFaktor("")).toEqual({ faktor: 1 });
    expect(einheitFaktor("t/a")).toEqual({ faktor: 1 });
    for (const t of ["t", "kg", "Tonnen"]) expect(einheitFaktor(t)).toMatchObject({ fehler: expect.stringMatching(/ohne Zeitbezug/) });
  });
  it.each([
    ["4500", 4500],
    ["1.200,5", 1200.5],
    ["1.200", 1200],
    ["1.234.567", 1234567],
    ["1200,5", 1200.5],
    ["1200.5", 1200.5],
    ["-15", -15],
    [" 12 000 ", 12000],
  ])("zahlAusText „%s“ → %s (deutsches Format: Punkt Tausender, Komma Dezimal)", (t, n) => {
    expect(zahlAusText(t)).toEqual({ wert: n });
  });
  it.each(["ca. 3000", "50-80", "1,234.5", "12 t", "–", "1.2.3"])("zahlAusText „%s“ ist ein Fehler", (t) => {
    expect(zahlAusText(t)).toMatchObject({ fehler: expect.stringMatching(/keine Zahl/) });
  });
  it.each([
    ["t/a", "t/a", 1],
    ["kg/a", "t/a", 0.001],
    ["t/Monat", "t/a", 12],
    ["MWh/a", "MWh/a", 1],
    ["kWh/a", "MWh/a", 0.001],
    ["GWh/a", "MWh/a", 1000],
    ["MWh pro Monat", "MWh/a", 12],
    ["Nm³/a", "Nm³/a", 1],
  ])("einheitOutput „%s“ → %s × %s", (t, code, faktor) => {
    expect(einheitOutput(t)).toEqual({ code, faktor });
  });
  it.each(["", "t", "Stück", "m³/a", "MWh", "l/a"])("einheitOutput „%s“ ist ein Fehler (keine Annahme)", (t) => {
    expect("fehler" in einheitOutput(t)).toBe(true);
  });
});

describe("B5: Kontaktdaten im Text (Muster E-Mail / Telefon)", () => {
  it.each(["musterfrau@example.com", "Rückruf bei Fr. Musterfrau, musterfrau@example.com", "07251 000000", "Herr Beispiel, 06221 000000", "+49 6221 123456", "Tel. 0621/12345-67"])("„%s“ enthaelt Kontaktdaten", (t) => {
    expect(enthaeltKontaktdaten(t)).toBe(true);
  });
  it.each(["Hans Beispielmann", "Agrarhof Lindenau GbR", "Buchen (Odenwald)", "Hauptstraße 12", "67346", "Freiburg (Elbe)", "Charge 2026/09", "0,5", "Weg 0815"])("„%s“ enthaelt keine Kontaktdaten", (t) => {
    expect(enthaeltKontaktdaten(t)).toBe(false);
  });
});

describe("Datum und Monat (Weggabelung 8)", () => {
  it("JJJJ-MM: „ab“ = Monatserster, „bis“ = Monatsletzter, mit Hinweis; Freitext bleibt Fehler", () => {
    expect(datumAusText("2027-03", "anfang")).toEqual({ wert: "2027-03-01", hinweis: expect.stringMatching(/Monatserster/) });
    expect(datumAusText("03/2027", "ende")).toEqual({ wert: "2027-03-31", hinweis: expect.stringMatching(/Monatsletzter/) });
    expect(datumAusText("2026-03-15", "anfang")).toEqual({ wert: "2026-03-15" });
    expect(datumAusText("5.3.2026", "ende")).toEqual({ wert: "2026-03-05" });
    expect(datumAusText("", "ende")).toEqual({ wert: "" });
    expect(datumAusText("ab sofort", "anfang")).toMatchObject({ fehler: expect.stringMatching(/kein Datum/) });
  });
  it("Monat: MM/JJJJ und JJJJ-MM ohne Hinweis, Datumszelle mit Hinweis, Freitext Fehler", () => {
    expect(monatAusText("01/2026")).toEqual({ wert: "2026-01" });
    expect(monatAusText("2027-03")).toEqual({ wert: "2027-03" });
    expect(monatAusText("2026-09-30")).toEqual({ wert: "2026-09", hinweis: expect.stringMatching(/als Monat 09\/2026/) });
    expect(monatAusText("")).toEqual({ wert: "" });
    expect(monatAusText("ab sofort")).toMatchObject({ fehler: expect.stringMatching(/kein Monat/) });
  });
});

describe("B3: Zuordnungsfehler bleiben an der Zeile (Testdatei, Blatt Biomasse)", () => {
  const f = (nr: number) => zeileZuFelder(biomasse.spalten, zeile(biomasse, nr), zBiomasse);

  it("Zeile 5 (Normalfall): keine Fehler, keine Hinweise, Beleg und Menge wie in der Datei", () => {
    const r = f(5);
    expect(r.fehlergrund).toBeNull();
    expect(zuordnungsFehler(r.felder)).toBeNull();
    expect(hinweise(r.felder)).toEqual([]);
    expect(r.felder).toMatchObject({ akteur_name: "Agrarhof Lindenau GbR", akteur_sitz_hausnummer: "12", akteur_sektor: "landwirtschaft", materialart_code: "rinderg_lle", menge_roh_fm: "4500", beleg_typ: "gespraech" });
    expect(Object.keys(r.felder)).not.toContain("Nr");
  });
  it("Zeile 6 („t“ ohne Zeitbezug): Fehler am Mengenfeld, Zeile scheitert", () => {
    const r = f(6);
    expect(r.felder[`${FEHLER_PREFIX}menge_roh_fm`]).toMatch(/ohne Zeitbezug/);
    expect(r.fehlergrund).toMatch(/ohne Zeitbezug/);
    expect(zuordnungsFehler(r.felder)).toMatch(/ohne Zeitbezug/);
  });
  it("Zeile 16 (m³/a) und 17 (t TM/a): Einheit nicht umrechenbar bzw. Trockenmasse → Fehler am Mengenfeld", () => {
    expect(f(16).felder[`${FEHLER_PREFIX}menge_roh_fm`]).toMatch(/nicht umrechenbar/);
    expect(f(17).felder[`${FEHLER_PREFIX}menge_roh_fm`]).toMatch(/Trockenmasse/);
    expect(f(16).fehlergrund).not.toBeNull();
  });
  it("Zeile 26 (Sektor „Gastronomie“ ohne Zuordnung): Fehler am Sektor, kein stiller Standard", () => {
    const r = f(26);
    expect(r.felder.akteur_sektor).toBe("");
    expect(r.felder[`${FEHLER_PREFIX}akteur_sektor`]).toMatch(/Gastronomie.*keinem Code zugeordnet/);
    expect(r.fehlergrund).toMatch(/Gastronomie/);
  });
  it("Zeile 22 (Spanne „50-80“) und 23 („ca. 3000“): keine lesbare Zahl → Fehler", () => {
    expect(f(22).felder[`${FEHLER_PREFIX}menge_roh_fm`]).toMatch(/keine Zahl/);
    expect(f(23).felder[`${FEHLER_PREFIX}menge_roh_fm`]).toMatch(/keine Zahl/);
  });
  it("Zeile 29 („ab sofort“): Monat nicht lesbar → Fehler am Zeitraum; Zeile 30 („2027-03“) ist ein gueltiger Monat", () => {
    expect(f(29).felder[`${FEHLER_PREFIX}zeitraum_von`]).toMatch(/kein Monat/);
    expect(f(30).felder.zeitraum_von).toBe("2027-03");
    expect(f(30).fehlergrund).toBeNull();
  });
});

describe("B8/E20: Zahlen und Mengen der Testdatei", () => {
  const f = (nr: number) => zeileZuFelder(biomasse.spalten, zeile(biomasse, nr), zBiomasse);
  it("Zeile 13 („1.200,5“ als Text): 1200,5 gelesen, auf 1.201 t FM/a gerundet, Hinweis an der Zeile", () => {
    const r = f(13);
    expect(r.felder.menge_roh_fm).toBe("1201");
    expect(r.felder[`${HINWEIS_PREFIX}menge_roh_fm`]).toMatch(/1\.200,5.*1\.201.*gerundet/);
    expect(r.fehlergrund).toBeNull();
  });
  it("Zeile 14 (350 t/Monat → 4.200) und 15 (80.000 kg/a → 80): umgerechnet mit Hinweis, Excel-Zahlen bleiben Zahlen", () => {
    expect(f(14).felder.menge_roh_fm).toBe("4200");
    expect(f(14).felder[`${HINWEIS_PREFIX}menge_roh_fm`]).toMatch(/4\.200 t FM\/a/);
    expect(f(15).felder.menge_roh_fm).toBe("80");
    expect(f(5).felder[`${HINWEIS_PREFIX}menge_roh_fm`]).toBeUndefined();
  });
  it("Zeile 32/33: Preis bleibt mit Vorzeichen und ohne Rundung; Belegdaten je Zeile", () => {
    expect(f(32).felder).toMatchObject({ preis_mittel: "85", beleg_typ: "angebot", beleg_erhebungsdatum: "2026-09-15", beleg_gueltig_bis: "2026-12-31" });
    expect(f(33).felder.preis_mittel).toBe("-15");
  });
  it("Zeile 28 (Datumszellen fuer den Zeitraum): Monat uebernommen, Hinweis an der Zeile", () => {
    const r = f(28);
    expect(r.felder.zeitraum_von).toBe("2026-10");
    expect(r.felder.zeitraum_bis).toBe("2027-01");
    expect(hinweise(r.felder)).toHaveLength(2);
  });
});

describe("B5: Kontaktdaten in der Testdatei", () => {
  const f = (nr: number) => zeileZuFelder(biomasse.spalten, zeile(biomasse, nr), zBiomasse);
  it("Zeile 27: Bemerkung mit E-Mail wird nicht uebernommen, Fehler „enthält Kontaktdaten“", () => {
    const r = f(27);
    expect(r.felder.bezeichnung).toBeUndefined();
    expect(r.felder[`${FEHLER_PREFIX}bezeichnung`]).toMatch(/enthält Kontaktdaten, bitte entfernen/);
    expect(JSON.stringify(r)).not.toMatch(/musterfrau|example\.com/i);
  });
  it("Zeile 34: Einzelunternehmer mit Personennamen bleibt als Akteur erlaubt", () => {
    const r = f(34);
    expect(r.felder.akteur_name).toBe("Hans Beispielmann");
    expect(r.fehlergrund).toBeNull();
  });
  it("Zeile 25: Personen-Spalten verlassen die Funktion nie", () => {
    expect(JSON.stringify(f(25))).not.toMatch(/Erika|07251|erika\.beispiel/);
  });
  it("bereinigte Kopie: die Zelle mit Kontaktdaten ist entfernt, Personen-Spalten fehlen", () => {
    const csv = bereinigteCsv(biomasse.spalten, biomasse.zeilen, zBiomasse);
    expect(csv).not.toMatch(/musterfrau|example\.com|Erika|07251|Ansprechpartner|E-Mail/i);
    expect(csv).toContain("[Kontaktdaten entfernt]");
    expect(csv).toContain("Hans Beispielmann");
  });
});

describe("E72 (2.7h): Zeilen 18, 21 und 39 der Testdatei", () => {
  const f = (nr: number) => zeileZuFelder(biomasse.spalten, zeile(biomasse, nr), zBiomasse);
  it("Zeile 18 (Mosbach ohne PLZ) und 21 (Freiburg ohne PLZ) gehen in „PLZ aus Ort“; mit PLZ nicht", () => {
    expect(f(18).felder).toMatchObject({ akteur_name: "Hofgut Kirchberg", akteur_sitz_ort: "Mosbach" });
    expect(f(18).felder.akteur_sitz_plz).toBe("");
    expect(brauchtPlzAusOrt(f(18).felder)).toBe(true);
    expect(f(21).felder).toMatchObject({ akteur_name: "Kompostwerk Breisgau", akteur_sitz_ort: "Freiburg" });
    expect(brauchtPlzAusOrt(f(21).felder)).toBe(true);
    expect(brauchtPlzAusOrt(f(19).felder)).toBe(false);
    expect(ortGruppen([{ id: "18", felder: f(18).felder }, { id: "21", felder: f(21).felder }, { id: "19", felder: f(19).felder }]).map((g) => [g.ort, g.zeilenIds])).toEqual([
      ["Mosbach", ["18"]],
      ["Freiburg", ["21"]],
    ]);
  });
  it("Zeile 39: „Mannheim-Neckarau“ passt zu 68199 (Mannheim) — Ortsteil-Toleranz, Ort unveraendert; Zeile 19 „Heidelberg“ zu 68159 nicht", () => {
    expect(f(39).felder).toMatchObject({ akteur_sitz_plz: "68199", akteur_sitz_ort: "Mannheim-Neckarau" });
    expect(ortPasst(f(39).felder.akteur_sitz_ort!, "mannheim")).toBe(true);
    expect(f(19).felder).toMatchObject({ akteur_sitz_plz: "68159", akteur_sitz_ort: "Heidelberg" });
    expect(ortPasst(f(19).felder.akteur_sitz_ort!, "mannheim")).toBe(false);
  });
});

describe("Doppelzeilen (Weggabelung 7)", () => {
  it("Zeile 24 ist die exakte Doppelzeile von Zeile 5 — und sonst keine", () => {
    const zeilen = biomasse.zeilen.map((z, i) => ({ zeilennummer: biomasse.zeilennummern[i]!, felder: zeileZuFelder(biomasse.spalten, z, zBiomasse).felder }));
    const d = findeDoppelzeilen(zeilen);
    expect([...d.entries()].map(([i, von]) => [zeilen[i]!.zeilennummer, von])).toEqual([[24, 5]]);
  });
});

describe("Einheiten bei Bedarfen (Weggabelung 9, Blatt Bedarfe)", () => {
  const f = (nr: number) => zeileZuFelder(bedarfe.spalten, zeile(bedarfe, nr), zBedarfe);
  it("MWh/a bleibt, kg/a wird t/a, GWh/a wird MWh/a — mit Hinweis; unbekanntes Produkt ist ein Fehler", () => {
    expect(f(2).felder).toMatchObject({ produkt_code: "waerme", menge_wert: "12000", menge_einheit: "MWh/a", zeitraum_von: "2027-01" });
    expect(f(2).fehlergrund).toBeNull();
    expect(f(7).felder).toMatchObject({ menge_wert: "30", menge_einheit: "t/a" });
    expect(f(7).felder[`${HINWEIS_PREFIX}menge_wert`]).toMatch(/30000 kg\/a.*30 t\/a/);
    expect(f(9).felder).toMatchObject({ menge_wert: "20000", menge_einheit: "MWh/a" });
    expect(f(8).felder[`${FEHLER_PREFIX}produkt_code`]).toMatch(/Kälte/);
  });
  it("Zeile 6: Personen-Spalte „Kontakt“ verlaesst die Funktion nie", () => {
    expect(JSON.stringify(f(6))).not.toMatch(/Beispiel|06221/);
  });
});

describe("E69: Preis-Bezug im Import", () => {
  it("Testdatei: „Preis €/t“ ist der Rohpreis ohne eigenen Bezug — Lauf-Standard fm wird vorgeschlagen; eine Kopfzeile mit atro/TM schlaegt atro vor", () => {
    expect(preisBezugVorschlag(biomasse.spalten, zBiomasse.spalten)).toBe("fm");
    expect(preisBezugVorschlag(["Betrieb", "Preis €/t atro"], { Betrieb: "akteur_name", "Preis €/t atro": "preis_mittel" })).toBe("atro");
    expect(preisBezugVorschlag(["Preis (t TM)"], { "Preis (t TM)": "preis_mittel" })).toBe("atro");
    // Nur Preis-Spalten zaehlen: „atro" in einer Mengenspalte aendert nichts.
    expect(preisBezugVorschlag(["Menge t atro", "Preis"], { "Menge t atro": "menge_roh_fm", Preis: "preis_mittel" })).toBe("fm");
    expect(zeileZuFelder(biomasse.spalten, zeile(biomasse, 32), zBiomasse).felder.preis_bezug).toBeUndefined();
  });
  it("eine Spalte „Preis-Bezug“ wird dem Zielfeld zugeordnet, Werte fm/atro per Werte-Zuordnung", () => {
    const spalten = ["Betrieb", "Preis", "Preis-Bezug"];
    const z: Zuordnung = { spalten: vorschlagZuordnung("biomasse", spalten), werte: { preis_bezug: { "je t atro": "atro" } } };
    expect(z.spalten["Preis-Bezug"]).toBe("preis_bezug");
    expect(zeileZuFelder(spalten, ["Hof", "85", "je t atro"], z).felder).toMatchObject({ preis_mittel: "85", preis_bezug: "atro" });
  });
});
