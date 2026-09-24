import { describe, expect, it } from "vitest";

import {
  dezimalAnzeige,
  dezimalKanonisch,
  istMehrdeutig,
  monatAnzeige,
  monatKanonisch,
} from "./eingabe-format";

describe("Monat", () => {
  it("zeigt die Speicherform deutsch an", () => {
    expect(monatAnzeige("2027-01")).toBe("01/2027");
    expect(monatAnzeige("2034-12")).toBe("12/2034");
    expect(monatAnzeige("")).toBe("");
  });

  it("nimmt, was Menschen tippen", () => {
    for (const eingabe of ["01/2027", "1/2027", "01.2027", "01-2027", "012027"]) {
      expect(monatKanonisch(eingabe)).toBe("2027-01");
    }
  });

  it("nimmt die Speicherform selbst an — ein bestehender Wert darf nicht verloren gehen", () => {
    expect(monatKanonisch("2027-01")).toBe("2027-01");
  });

  it("gibt leer zurück, solange die Eingabe unfertig ist", () => {
    for (const eingabe of ["", "0", "01", "01/", "01/20"]) {
      expect(monatKanonisch(eingabe)).toBe("");
    }
  });

  it("weist unmögliche Monate ab", () => {
    expect(monatKanonisch("13/2027")).toBe("");
    expect(monatKanonisch("00/2027")).toBe("");
    expect(monatKanonisch("2027-13")).toBe("");
  });

  it("hin und zurück verliert nichts", () => {
    for (const k of ["2026-01", "2027-06", "2099-12"]) {
      expect(monatKanonisch(monatAnzeige(k))).toBe(k);
    }
  });
});

describe("Dezimalzahlen", () => {
  it("zeigt den Punkt aus der Datenbank als Komma", () => {
    expect(dezimalAnzeige("4268.00")).toBe("4268,00");
    expect(dezimalAnzeige("87")).toBe("87");
    expect(dezimalAnzeige(null)).toBe("");
  });

  it("nimmt das Komma an — der eigentliche Befund aus dem Praxistest", () => {
    expect(dezimalKanonisch("1,5")).toBe("1.5");
    expect(dezimalKanonisch("33,333")).toBe("33.333");
    expect(dezimalKanonisch("-95,5")).toBe("-95.5");
  });

  it("nimmt den Punkt weiterhin an — niemand wird umgewöhnt", () => {
    expect(dezimalKanonisch("1.5")).toBe("1.5");
    expect(dezimalKanonisch("33.333")).toBe("33.333");
  });

  it("raet bei Punkt-Dreiergruppen nicht, sondern meldet sie als mehrdeutig", () => {
    // "10.000" kann zehntausend sein, "33.333" ein TS-Anteil in Prozent.
    // Beide Deutungen waeren still falsch — Number("10.000") ist 10.
    expect(istMehrdeutig("10.000")).toBe(true);
    expect(istMehrdeutig("1.234.567")).toBe(true);
    expect(istMehrdeutig("33.333")).toBe(true);
  });

  it("ist eindeutig, sobald ein Komma dabei ist", () => {
    expect(istMehrdeutig("1.234,5")).toBe(false);
    expect(dezimalKanonisch("1.234,5")).toBe("1234.5");
    expect(dezimalKanonisch("10.000,5")).toBe("10000.5");
  });

  it("ist eindeutig ohne Dreiergruppe", () => {
    expect(istMehrdeutig("1.5")).toBe(false);
    expect(istMehrdeutig("33.33")).toBe(false);
    expect(istMehrdeutig("87")).toBe(false);
    expect(istMehrdeutig("")).toBe(false);
  });

  it("laesst Leerraum und geschuetzte Leerzeichen weg", () => {
    expect(dezimalKanonisch(" 1 234,5 ")).toBe("1234.5");
    expect(dezimalKanonisch("1 234,5")).toBe("1234.5");
  });

  it("gibt Unsinn unveraendert zurueck — die Validierung meldet ihn", () => {
    expect(dezimalKanonisch("abc")).toBe("abc");
    expect(dezimalKanonisch("")).toBe("");
  });

  it("hin und zurück verliert nichts", () => {
    for (const roh of ["4268.00", "0.1", "87", "-95.5"]) {
      expect(dezimalKanonisch(dezimalAnzeige(roh))).toBe(roh);
    }
  });
});
