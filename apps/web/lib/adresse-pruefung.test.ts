import { describe, expect, it } from "vitest";

import { entscheideAdresse, normalisiereStrasse, suchtextAus, type Kandidat } from "./adresse-pruefung";

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
  });
});
