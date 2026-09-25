import { describe, expect, it } from "vitest";

import { sektorAusEingabe } from "./akteur-anlage";

const CODES = ["energie", "landwirtschaft"];

describe("Sektor bei der Akteur-Anlage: nur Werte der Referenztabelle", () => {
  it("ein bekannter Code geht durch", () => {
    expect(sektorAusEingabe("energie", CODES)).toEqual({ ok: true, sektor: "energie" });
  });

  it("leer, fehlend oder nur Leerraum heisst 'ohne Sektor' (null)", () => {
    expect(sektorAusEingabe("", CODES)).toEqual({ ok: true, sektor: null });
    expect(sektorAusEingabe(undefined, CODES)).toEqual({ ok: true, sektor: null });
    expect(sektorAusEingabe("   ", CODES)).toEqual({ ok: true, sektor: null });
  });

  it("ein unbekannter Wert wird abgewiesen UND genannt — kein 500 aus dem Fremdschluessel", () => {
    const erg = sektorAusEingabe("Entsorgung", CODES);
    expect(erg.ok).toBe(false);
    if (!erg.ok) expect(erg.fehler).toContain("Entsorgung");
  });

  it("keine stille Normalisierung: 'Energie' ist nicht 'energie'", () => {
    // Die Auswahlliste liefert Codes; kommt etwas anderes an, stimmt der
    // Aufrufer nicht, und das soll auffallen statt zurechtgebogen werden.
    expect(sektorAusEingabe("Energie", CODES).ok).toBe(false);
  });

  it("nur Strings zaehlen", () => {
    expect(sektorAusEingabe(42, CODES).ok).toBe(false);
  });
});
