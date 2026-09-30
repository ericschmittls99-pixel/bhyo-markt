import { describe, expect, it } from "vitest";

import { heuteBerlin, istSeitEinfuehrung, pruefeParameterEingabe, wertMitEinheit } from "./parameter";

const DEF = { schluessel: "verifikationsfrist.gespraech", bezeichnung: "Gespräch", einheit: "monate", min: 1, max: 120, beschreibung: "" };
const HEUTE = "2026-09-30";

describe("pruefeParameterEingabe (E60)", () => {
  it("nimmt einen Wert im Bereich ab heute mit Begründung an", () => {
    expect(pruefeParameterEingabe(DEF, { wert: 4, gueltigAb: HEUTE, begruendung: "Rücksprache Fachbereich" }, HEUTE)).toBeNull();
    expect(pruefeParameterEingabe(DEF, { wert: 4, gueltigAb: "2027-01-01", begruendung: "x" }, HEUTE)).toBeNull();
  });
  it("weist Werte ausserhalb min/max und Nicht-Ganzzahlen ab", () => {
    expect(pruefeParameterEingabe(DEF, { wert: 0, gueltigAb: HEUTE, begruendung: "x" }, HEUTE)?.grund).toBe("wert");
    expect(pruefeParameterEingabe(DEF, { wert: 121, gueltigAb: HEUTE, begruendung: "x" }, HEUTE)?.grund).toBe("wert");
    expect(pruefeParameterEingabe(DEF, { wert: 2.5, gueltigAb: HEUTE, begruendung: "x" }, HEUTE)?.grund).toBe("wert");
    expect(pruefeParameterEingabe(DEF, { wert: NaN, gueltigAb: HEUTE, begruendung: "x" }, HEUTE)?.grund).toBe("wert");
  });
  it("nie rueckwirkend: ein Datum vor heute wird abgewiesen, heute selbst nicht", () => {
    expect(pruefeParameterEingabe(DEF, { wert: 4, gueltigAb: "2026-09-29", begruendung: "x" }, HEUTE)?.grund).toBe("datum");
    expect(pruefeParameterEingabe(DEF, { wert: 4, gueltigAb: "kein-datum", begruendung: "x" }, HEUTE)?.grund).toBe("datum");
    expect(pruefeParameterEingabe(DEF, { wert: 4, gueltigAb: HEUTE, begruendung: "x" }, HEUTE)).toBeNull();
  });
  it("Begründung ist Pflicht; unbekannter Parameter wird abgewiesen", () => {
    expect(pruefeParameterEingabe(DEF, { wert: 4, gueltigAb: HEUTE, begruendung: "   " }, HEUTE)?.grund).toBe("begruendung");
    expect(pruefeParameterEingabe(undefined, { wert: 4, gueltigAb: HEUTE, begruendung: "x" }, HEUTE)?.grund).toBe("unbekannt");
  });
});

describe("Anzeige", () => {
  it("'-infinity' ist der benannte Zustand seit Einführung", () => {
    expect(istSeitEinfuehrung("-infinity")).toBe(true);
    expect(istSeitEinfuehrung("2026-09-30")).toBe(false);
  });
  it("Wert mit Einheit", () => {
    expect(wertMitEinheit(3, "monate")).toBe("3 Monate");
    expect(wertMitEinheit(1, "monate")).toBe("1 Monat");
  });
  it("heuteBerlin liefert das Datum in Europe/Berlin (Tageswechsel vor UTC)", () => {
    expect(heuteBerlin(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
    expect(heuteBerlin(new Date("2026-09-30T21:30:00Z"))).toBe("2026-09-30");
  });
});
