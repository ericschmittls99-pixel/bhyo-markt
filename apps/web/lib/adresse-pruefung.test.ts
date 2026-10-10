import { describe, expect, it } from "vitest";

import { entscheideAdresse, normalisiereStrasse, ortNachTreffer, ortsteilAufteilen, suchtextAus, type Kandidat } from "./adresse-pruefung";

const eingabe = { strasse: "Iggelheimer Straße", hausnummer: "12", plz: "67346", ort: "Speyer" };
const k = (t: Partial<Kandidat>): Kandidat => ({ art: "adresse", strasse: "Iggelheimer Straße", hausnummer: "12", plz: "67346", ort: "Speyer", kreis: null, land: null, lng: 8.43, lat: 49.32, imGebiet: true, ...t });
const rueckfall = { lng: 8.44, lat: 49.33 };

describe("entscheideAdresse (E68 PR 2)", () => {
  it("Treffer mit Hausnummer im PLZ-Gebiet -> Pin, Genauigkeit hausnummer", () => {
    const r = entscheideAdresse(eingabe, [k({})], rueckfall, false);
    expect(r.status).toBe("treffer");
    if (r.status === "treffer") expect(r.genauigkeit).toBe("hausnummer");
  });
  it("Straße gefunden, Hausnummer nicht -> Genauigkeit strasse mit Hinweis", () => {
    const r = entscheideAdresse(eingabe, [k({ hausnummer: null })], rueckfall, false);
    expect(r.status).toBe("treffer");
    if (r.status === "treffer") {
      expect(r.genauigkeit).toBe("strasse");
      expect(r.text).toMatch(/Hausnummer nicht/);
    }
  });
  it("Rot: Tippfehler in der Straße -> „Meinten Sie …?“ mit hoechstens drei Kandidaten", () => {
    const r = entscheideAdresse({ ...eingabe, strasse: "Igelheimer Str" }, [k({}), k({ strasse: "Iggelheimer Straße", hausnummer: "14" }), k({ strasse: "Iggelheimer Straße", hausnummer: "16" }), k({ strasse: "Iggelheimer Straße", hausnummer: "18" })], rueckfall, false);
    expect(r.status).toBe("kandidaten");
    if (r.status === "kandidaten") {
      expect(r.kandidaten).toHaveLength(3);
      expect("imGebiet" in r.kandidaten[0]!).toBe(false);
    }
  });
  it("Rot: Zeitlimit/Ausfall -> Pin auf das PLZ-Gebiet mit Genauigkeit plz_gebiet", () => {
    const r = entscheideAdresse(eingabe, [], rueckfall, true);
    expect(r).toEqual({ status: "plz_gebiet", text: expect.stringMatching(/nicht erreichbar.*verschieben/), pin: rueckfall, genauigkeit: "plz_gebiet" });
  });
  it("Treffer ausserhalb des PLZ-Gebiets zaehlt nicht -> PLZ-Gebiet", () => {
    const r = entscheideAdresse(eingabe, [k({ imGebiet: false })], rueckfall, false);
    expect(r.status).toBe("plz_gebiet");
  });
  it("„Str.“ und „straße“ sind dieselbe Straße", () => {
    expect(normalisiereStrasse("Iggelheimer Str.")).toBe(normalisiereStrasse("Iggelheimer Straße"));
    expect(normalisiereStrasse("Hauptstr")).toBe("hauptstrasse");
    expect(normalisiereStrasse("Hauptstr.")).toBe("hauptstrasse");
  });
  it("ohne Rueckfall und ohne Treffer: Pin von Hand", () => {
    expect(entscheideAdresse(eingabe, [], null, false).status).toBe("dienst_fehlt");
  });
  it("suchtextAus baut eine Anfrage aus den Feldern", () => {
    expect(suchtextAus(eingabe)).toBe("Iggelheimer Straße 12, 67346 Speyer");
    expect(suchtextAus({ strasse: "", hausnummer: "", plz: "67346", ort: "" })).toBe("67346");
    expect(suchtextAus({ strasse: "Rheinstraße", hausnummer: "1", plz: "68199", ort: "Mannheim" }, "Neckarau")).toBe("Rheinstraße 1, 68199 Mannheim Neckarau");
  });
});

describe("ortsteilAufteilen (AP6, Vormerkung §47): amtlicher Ort an den Dienst, Ortsteil als Zusatz", () => {
  it("„Mannheim-Neckarau“ und „Stuttgart Vaihingen“ -> amtlicher Ort plus Zusatz", () => {
    expect(ortsteilAufteilen("Mannheim-Neckarau", ["Mannheim"])).toEqual({ ort: "Mannheim", zusatz: "Neckarau" });
    expect(ortsteilAufteilen("Stuttgart Vaihingen", ["Stuttgart"])).toEqual({ ort: "Stuttgart", zusatz: "Vaihingen" });
    expect(ortsteilAufteilen("Bad Homburg v. d. Höhe / Ober-Erlenbach", ["Bad Homburg v. d. Höhe"])).toEqual({ ort: "Bad Homburg v. d. Höhe", zusatz: "Ober Erlenbach" });
  });
  it("Rot: gleicher Ort, Kurzform, Straßenname oder fremder Ort -> null (Eingabe bleibt)", () => {
    expect(ortsteilAufteilen("Mannheim", ["Mannheim"])).toBeNull();
    expect(ortsteilAufteilen("Ludwigshafen", ["Ludwigshafen am Rhein"])).toBeNull();
    expect(ortsteilAufteilen("Mannheimer Str.", ["Mannheim"])).toBeNull();
    expect(ortsteilAufteilen("Heidelberg-Rohrbach", ["Mannheim"])).toBeNull();
    expect(ortsteilAufteilen("", ["Mannheim"])).toBeNull();
  });
  it("mehrere amtliche Orte: der laengste passende gewinnt", () => {
    expect(ortsteilAufteilen("Bad Homburg Kirdorf", ["Bad", "Bad Homburg"])).toEqual({ ort: "Bad Homburg", zusatz: "Kirdorf" });
  });
});

describe("ortNachTreffer (AP6, Eric 09.10.2026 — Anwendung von E72 e)", () => {
  it("Ortsteil-Form passt zum Dienst-Ort → Eingabe bleibt", () => {
    expect(ortNachTreffer("Mannheim-Neckarau", "Mannheim")).toBe("Mannheim-Neckarau");
    expect(ortNachTreffer("Stuttgart Vaihingen", "Stuttgart")).toBe("Stuttgart Vaihingen");
    expect(ortNachTreffer("mannheim", "Mannheim")).toBe("mannheim");
  });
  it("echte Abweichung → Ort des Dienstes, wie bisher", () => {
    expect(ortNachTreffer("Ludwigshafen", "Mannheim")).toBe("Mannheim");
    expect(ortNachTreffer("Neckarau", "Mannheim")).toBe("Mannheim");
    expect(ortNachTreffer("", "Mannheim")).toBe("Mannheim");
  });
  it("ohne Dienst-Ort bleibt die Eingabe", () => {
    expect(ortNachTreffer("Mannheim-Neckarau", null)).toBe("Mannheim-Neckarau");
  });
});

