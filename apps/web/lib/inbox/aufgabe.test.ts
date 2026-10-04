import { describe, expect, it } from "vitest";

import { AUFGABE_MAX, AUFGABE_VORGABE, pruefeAufgabe } from "./aufgabe";

describe("Aufgabentext (E63, D5)", () => {
  it("Vorgabe Bitte aktualisieren, Rand wird abgeschnitten", () => {
    expect(AUFGABE_VORGABE).toBe("Bitte aktualisieren");
    expect(pruefeAufgabe("  Bitte aktualisieren \n")).toEqual({ ok: true, text: "Bitte aktualisieren" });
  });
  it("leer, nur Leerraum, null → Fehler", () => {
    for (const e of ["", "   ", "\t\n", null, undefined]) expect(pruefeAufgabe(e)).toEqual({ ok: false, fehler: "Der Aufgabentext darf nicht leer sein." });
  });
  it("500 Zeichen erlaubt, 501 nicht (nach dem Abschneiden des Rands)", () => {
    expect(pruefeAufgabe("x".repeat(AUFGABE_MAX)).ok).toBe(true);
    expect(pruefeAufgabe(" " + "x".repeat(AUFGABE_MAX) + " ").ok).toBe(true);
    expect(pruefeAufgabe("x".repeat(AUFGABE_MAX + 1))).toEqual({ ok: false, fehler: "Der Aufgabentext darf höchstens 500 Zeichen haben." });
  });
});
