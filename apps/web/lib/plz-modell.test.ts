import { describe, expect, it } from "vitest";

import { plzPruefungText, plzTrefferZuAdresse } from "./plz-modell";

describe("plzPruefungText (E68 PR 1)", () => {
  it("Rot: unbekannte PLZ wird abgewiesen", () => {
    expect(plzPruefungText({ plzBekannt: false, ortPasst: false, orte: [] }, "00000")).toBe("PLZ 00000 ist unbekannt — bitte prüfen.");
  });
  it("Rot: Ort passt nicht → Vorschlag der richtigen Orte, hoechstens drei", () => {
    expect(plzPruefungText({ plzBekannt: true, ortPasst: false, orte: ["Altenkirchen", "Bitburg", "Dudeldorf", "Esch"] }, "54636")).toBe(
      "Ort passt nicht zur PLZ 54636 — meinten Sie Altenkirchen, Bitburg, Dudeldorf …?",
    );
  });
  it("passt → kein Text", () => {
    expect(plzPruefungText({ plzBekannt: true, ortPasst: true, orte: ["Speyer"] }, "67346")).toBeNull();
  });
  it("Treffer aus dem Pin wird eine Adresse der Art plz ohne Strassenanteil; ein Ort eindeutig, mehrere bleiben offen", () => {
    expect(plzTrefferZuAdresse({ plz: "67346", orte: ["Speyer"] }, { lng: 8.43, lat: 49.32 })).toEqual({
      art: "plz", strasse: null, hausnummer: null, plz: "67346", ort: "Speyer", kreis: null, land: null, lng: 8.43, lat: 49.32, orte: ["Speyer"],
    });
    expect(plzTrefferZuAdresse({ plz: "54636", orte: ["Bitburg", "Esch"] }, { lng: 6.5, lat: 50.0 }).ort).toBeNull();
  });
});
