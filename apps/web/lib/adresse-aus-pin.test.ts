import { describe, expect, it } from "vitest";

import { uebernimmAusPin, type AdresseWerte } from "./adresse-aus-pin";
import type { Adresse } from "./geocode";

const leer: AdresseWerte = { strasse: "", hausnummer: "", plz: "", ort: "", lat: "49.32", lng: "8.43" };
const treffer: Adresse = { art: "adresse", kreis: null, land: "Rheinland-Pfalz", strasse: "Iggelheimer Straße", hausnummer: null, plz: "67346", ort: "Speyer", lng: 8.4, lat: 49.33 };

describe("uebernimmAusPin (Sitz-Erfassung a)", () => {
  it("Karten-Klick: PLZ und Ort aus dem Pin, Straße bleibt (E68 PR 1), Pin bleibt, wo gesetzt", () => {
    const r = uebernimmAusPin({ ...leer, strasse: "Alt", hausnummer: "7", plz: "11111", ort: "Altort" }, treffer, "pin");
    expect(r.werte).toEqual({ strasse: "Alt", hausnummer: "7", plz: "67346", ort: "Speyer", lat: "49.32", lng: "8.43" });
    expect(r.hinweis).toBe("PLZ und Ort aus Pin übernommen.");
  });

  it("Karten-Klick ohne PLZ am Treffer: Feld bleibt leer, klare Meldung", () => {
    const r = uebernimmAusPin({ ...leer, plz: "11111" }, { ...treffer, strasse: null, plz: null, ort: "Dannstadt-Schauernheim" }, "pin");
    expect(r.werte.plz).toBe("");
    expect(r.werte.ort).toBe("Dannstadt-Schauernheim");
    expect(r.hinweis).toBe("Am Pin wurde keine PLZ gefunden — PLZ bitte von Hand eintragen.");
  });

  it("Karten-Klick ohne Treffer: PLZ und Ort leer, Meldung nennt beides", () => {
    const r = uebernimmAusPin({ ...leer, plz: "11111", ort: "Altort" }, null, "pin");
    expect(r.werte.plz).toBe("");
    expect(r.werte.ort).toBe("");
    expect(r.hinweis).toBe("Am Pin wurde keine Adresse gefunden — PLZ und Ort bitte von Hand eintragen.");
  });

  it("Von Standort übernehmen: nur fehlende PLZ/Ort ergänzen, Straße des Standorts bleibt", () => {
    const r = uebernimmAusPin({ ...leer, strasse: "Hofweg", hausnummer: "3", ort: "Speyer" }, treffer, "ergaenzen");
    expect(r.werte).toEqual({ strasse: "Hofweg", hausnummer: "3", plz: "67346", ort: "Speyer", lat: "49.32", lng: "8.43" });
    expect(r.hinweis).toBe("PLZ aus Pin ergänzt.");
  });

  it("Von Standort übernehmen: nichts fehlt, nichts passiert", () => {
    const alt = { ...leer, strasse: "Hofweg", plz: "67346", ort: "Speyer" };
    const r = uebernimmAusPin(alt, { ...treffer, plz: "99999", ort: "Anders" }, "ergaenzen");
    expect(r.werte).toEqual(alt);
    expect(r.hinweis).toBeNull();
  });

  it("Von Standort übernehmen: Treffer ohne PLZ laesst das Feld leer und meldet es", () => {
    const r = uebernimmAusPin({ ...leer, ort: "Speyer" }, { ...treffer, plz: null }, "ergaenzen");
    expect(r.werte.plz).toBe("");
    expect(r.hinweis).toBe("Am Pin wurde keine PLZ gefunden — PLZ bitte von Hand eintragen.");
  });
});
