/**
 * AP2.7 PR b (E67): Adressen je eindeutiger Adresse, Treffer-Auswahl ohne
 * Raten (PLZ muss stimmen, mit Strasse nur Adress-Treffer), offen mit Grund.
 */
import { describe, expect, it } from "vitest";

import type { Adresse } from "./geocode";
import { adressGruppen, adressText, brauchtSitz, sitzAusLokal, sitzPatch, waehleSitz } from "./import-adressen";

const adresse = (teil: Partial<Adresse>): Adresse => ({ art: "adresse", strasse: "Dorfstraße", hausnummer: "3", plz: "67346", ort: "Speyer", kreis: null, land: null, lng: 8.43, lat: 49.32, ...teil });

describe("adressGruppen", () => {
  it("nimmt nur neue Akteure ohne Pin und ohne Befund, je Adresse einmal (Normalform)", () => {
    const g = adressGruppen([
      { id: "a", felder: { akteur_neu: "1", akteur_sitz_strasse: "Dorfstraße", akteur_sitz_hausnummer: "3", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
      { id: "b", felder: { akteur_neu: "1", akteur_sitz_strasse: "Dorfstrasse ", akteur_sitz_hausnummer: "3", akteur_sitz_plz: "67346", akteur_sitz_ort: "SPEYER" } },
      { id: "c", felder: { akteur_id: "x", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer" } },
      { id: "d", felder: { akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal", akteur_sitz_lat: "49.1", akteur_sitz_lng: "8.6" } },
      { id: "e", felder: { akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal", akteur_sitz_offen: "Kein Treffer" } },
      { id: "f", felder: { akteur_neu: "1", akteur_sitz_plz: "76646", akteur_sitz_ort: "Bruchsal" } },
    ]);
    expect(g.map((x) => [x.zeilenIds, adressText(x)])).toEqual([
      [["a", "b"], "Dorfstraße 3, 67346 Speyer"],
      [["f"], "76646 Bruchsal"],
    ]);
    expect(brauchtSitz({ akteur_neu: "1" })).toBe(true);
    expect(brauchtSitz({ akteur_neu: "1", akteur_sitz_lat: "1", akteur_sitz_lng: "2" })).toBe(false);
  });
});

describe("waehleSitz", () => {
  const g = { strasse: "Dorfstraße", hausnummer: "3", plz: "67346", ort: "Speyer" };

  it("mit Strasse: erster Adress-Treffer mit passender PLZ", () => {
    const e = waehleSitz(g, [adresse({ art: "ort", plz: "67346" }), adresse({ plz: "67346", lat: 49.3201 })]);
    expect(e).toEqual({ lat: 49.3201, lng: 8.43, plz: "67346", ort: "Speyer" });
  });

  it("PLZ weicht ab → offen mit Grund, nichts geraten", () => {
    expect(waehleSitz(g, [adresse({ plz: "67354" })])).toEqual({ offen: "PLZ weicht ab: Treffer hat 67354, die Datei 67346." });
  });

  it("mit Strasse genuegt kein Orts-Treffer; ohne Strasse schon (unvollstaendiger Sitz, E66)", () => {
    expect(waehleSitz(g, [adresse({ art: "ort", strasse: null, hausnummer: null })])).toEqual({ offen: "Kein Adress-Treffer — nur Ort oder Objekt gefunden." });
    expect(waehleSitz({ strasse: "", hausnummer: "", plz: "67346", ort: "Speyer" }, [adresse({ art: "ort", strasse: null, hausnummer: null, lat: 49.3, lng: 8.4 })])).toEqual({ lat: 49.3, lng: 8.4, plz: "67346", ort: "Speyer" });
  });

  it("fehlende PLZ in der Datei kommt aus dem Treffer; ohne PLZ und Ort bleibt es offen", () => {
    expect(waehleSitz({ strasse: "Dorfstraße", hausnummer: "3", plz: "", ort: "Speyer" }, [adresse({})])).toEqual({ lat: 49.32, lng: 8.43, plz: "67346", ort: "Speyer" });
    expect(waehleSitz({ strasse: "Dorfstraße", hausnummer: "3", plz: "", ort: "" }, [adresse({})])).toEqual({ offen: "Weder PLZ noch Ort angegeben — die Straße allein bestimmt keinen Sitz." });
    expect(waehleSitz(g, [])).toEqual({ offen: "Kein Treffer der Adresssuche." });
  });

  it("sitzPatch schreibt Maschinenwerte mit Dezimalpunkt und die Quelle", () => {
    expect(sitzPatch({ lat: 49.32, lng: 8.43, plz: "67346", ort: "Speyer" })).toEqual({ akteur_sitz_lat: "49.32", akteur_sitz_lng: "8.43", akteur_sitz_plz: "67346", akteur_sitz_ort: "Speyer", akteur_sitz_quelle: "photon", akteur_sitz_genauigkeit: "unbekannt" });
    expect(sitzPatch({ offen: "x" })).toEqual({ akteur_sitz_offen: "x" });
  });
});

describe("sitzAusLokal (E68 PR 3: lokale Zuordnung, Befunde als Satz)", () => {
  const pin = { lng: 8.43, lat: 49.32 };
  it("PLZ bekannt, Ort passt -> Pin im PLZ-Gebiet, Genauigkeit plz_gebiet", () => {
    expect(sitzAusLokal({ plz: "67346", ort: "Speyer" }, { plzBekannt: true, ortPasst: true, orte: ["Speyer"], pin })).toEqual({ lat: 49.32, lng: 8.43, plz: "67346", ort: "Speyer", genauigkeit: "plz_gebiet", quelle: "plz_gebiet" });
  });
  it("Rot: unbekannte PLZ -> offen mit Satz", () => {
    expect(sitzAusLokal({ plz: "00000", ort: "X" }, { plzBekannt: false, ortPasst: false, orte: [], pin: null })).toEqual({ offen: "PLZ 00000 ist unbekannt — bitte prüfen." });
  });
  it("Rot: Ort passt nicht -> „Meinten Sie …?“ mit hoechstens drei Orten", () => {
    expect(sitzAusLokal({ plz: "54636", ort: "Bitburgg" }, { plzBekannt: true, ortPasst: false, orte: ["Altenkirchen", "Bitburg", "Dudeldorf", "Esch"], pin })).toEqual({ offen: "Ort passt nicht zur PLZ 54636 — meinten Sie Altenkirchen, Bitburg, Dudeldorf …?" });
  });
  it("ohne Ort: einziger Ort der PLZ wird uebernommen, mehrere bleiben offen mit Liste", () => {
    expect(sitzAusLokal({ plz: "67346", ort: "" }, { plzBekannt: true, ortPasst: false, orte: ["Speyer"], pin })).toMatchObject({ ort: "Speyer", genauigkeit: "plz_gebiet" });
    expect(sitzAusLokal({ plz: "54636", ort: "" }, { plzBekannt: true, ortPasst: false, orte: ["A", "B"], pin })).toEqual({ offen: "PLZ 54636 hat 2 Orte — Ort angeben: A, B" });
  });
  it("ohne PLZ keine lokale Zuordnung", () => {
    expect(sitzAusLokal({ plz: "", ort: "Speyer" }, { plzBekannt: false, ortPasst: false, orte: [], pin: null })).toEqual({ offen: "Ohne PLZ keine Zuordnung — PLZ in der Zeile ergänzen." });
  });
});
