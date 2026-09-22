import { describe, expect, it } from "vitest";

import {
  istLeereVergabe,
  leiteVerfuegbarkeitAb,
  naechsteReserviertSeit,
  verfuegbarkeitLabel,
  verfuegbarkeitPill,
  validiereVergaben,
  vergabeLabel,
  vergabenZuFormZeilen,
  vergabenZuWerten,
  type VergabeDaten,
  type VergabeFormZeile,
} from "./verfuegbarkeit";

const strom = {
  zeitraumVon: "2026-01-01",
  zeitraumBis: "2030-12-31",
  reserviertBhyo: false,
};
const v = (o: Partial<VergabeDaten>): VergabeDaten => ({
  vergebenVon: null,
  vergebenBis: null,
  vergebenAn: null,
  anBhyo: false,
  ...o,
});

describe("leiteVerfuegbarkeitAb", () => {
  it("abgelaufen schlaegt alles (Regel 1)", () => {
    expect(
      leiteVerfuegbarkeitAb("2031-01-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2026-01-01" }),
      ]),
    ).toEqual({ status: "abgelaufen", reserviertZusatz: true });
  });

  it("noch nicht verfuegbar vor Verfuegbarkeitsbeginn (Regel 2)", () => {
    expect(leiteVerfuegbarkeitAb("2025-12-31", strom, []).status).toBe(
      "noch_nicht_verfuegbar",
    );
  });

  it("verfuegbar ohne Vergaben und ohne Reservierung (Regel 5)", () => {
    expect(leiteVerfuegbarkeitAb("2027-06-15", strom, [])).toEqual({
      status: "verfuegbar",
      reserviertZusatz: false,
    });
  });

  it("vergeben (extern) wenn heute im Vergabezeitraum liegt (Regel 3)", () => {
    const erg = leiteVerfuegbarkeitAb("2027-06-15", strom, [
      v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
    ]);
    expect(erg.status).toBe("vergeben_extern");
  });

  it("vergeben (bhyo) wenn an_bhyo gesetzt ist", () => {
    const erg = leiteVerfuegbarkeitAb("2027-06-15", strom, [
      v({ vergebenVon: "2027-01-01", anBhyo: true }),
    ]);
    expect(erg.status).toBe("vergeben_bhyo");
  });

  it("offenes von zaehlt ab Verfuegbarkeitsbeginn", () => {
    const vergaben = [v({ vergebenBis: "2028-06-30" })];
    expect(leiteVerfuegbarkeitAb("2026-01-01", strom, vergaben).status).toBe(
      "vergeben_extern",
    );
    expect(leiteVerfuegbarkeitAb("2028-07-01", strom, vergaben).status).toBe(
      "verfuegbar",
    );
  });

  it("offenes bis heisst unbefristet (bis Verfuegbarkeitsende)", () => {
    const vergaben = [v({ vergebenVon: "2027-01-01" })];
    expect(leiteVerfuegbarkeitAb("2030-12-31", strom, vergaben).status).toBe(
      "vergeben_extern",
    );
  });

  it("reserviert (bhyo) ohne aktive Vergabe (Regel 4)", () => {
    expect(
      leiteVerfuegbarkeitAb(
        "2027-06-15",
        { ...strom, reserviertBhyo: true },
        [],
      ).status,
    ).toBe("reserviert_bhyo");
  });

  it("Randfall: Reservierung + aktive externe Vergabe -> Zusatz-Pille", () => {
    expect(
      leiteVerfuegbarkeitAb("2027-06-15", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]),
    ).toEqual({ status: "vergeben_extern", reserviertZusatz: true });
  });

  it("Reservierung erzeugt den Nebentag IMMER, wenn sie nicht selbst Haupttag ist", () => {
    // Beschluss 22.09.2026: Regeln 1-3 bestimmen den Haupttag, die
    // Reservierung erscheint dann zusaetzlich — nicht nur bei externer Vergabe.
    const reserviert = {
      zeitraumVon: "2028-01-01",
      zeitraumBis: "2030-12-31",
      reserviertBhyo: true,
    };
    expect(leiteVerfuegbarkeitAb("2026-09-22", reserviert, [])).toEqual({
      status: "noch_nicht_verfuegbar",
      reserviertZusatz: true,
    });
    expect(leiteVerfuegbarkeitAb("2031-01-01", reserviert, [])).toEqual({
      status: "abgelaufen",
      reserviertZusatz: true,
    });
    expect(
      leiteVerfuegbarkeitAb("2028-06-15", reserviert, [
        v({ vergebenVon: "2028-01-01", anBhyo: true }),
      ]),
    ).toEqual({ status: "vergeben_bhyo", reserviertZusatz: true });
    // Selbst Haupttag -> kein Nebentag.
    expect(leiteVerfuegbarkeitAb("2028-06-15", reserviert, [])).toEqual({
      status: "reserviert_bhyo",
      reserviertZusatz: false,
    });
  });

  it("nach Vergabe-Ende faellt der Strom auf die Reservierung zurueck", () => {
    expect(
      leiteVerfuegbarkeitAb("2028-07-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]).status,
    ).toBe("reserviert_bhyo");
  });
});

describe("verfuegbarkeitPill — Label-Saetze je Stromart (Beschluss 22.09.2026)", () => {
  it("Feedstock-Labels", () => {
    expect(verfuegbarkeitPill("biomasse", "vergeben_extern").text).toBe(
      "vergeben (extern).",
    );
    expect(verfuegbarkeitPill("biomasse", "verfuegbar").text).toBe("verfügbar.");
  });
  it("Output-Labels: gedeckt/offen", () => {
    expect(verfuegbarkeitPill("output", "vergeben_extern").text).toBe(
      "gedeckt (extern).",
    );
    expect(verfuegbarkeitPill("output", "vergeben_bhyo").text).toBe(
      "gedeckt (bhyo).",
    );
    expect(verfuegbarkeitPill("output", "verfuegbar").text).toBe("offen.");
    expect(verfuegbarkeitPill("output", "reserviert_bhyo").text).toBe(
      "reserviert (bhyo).",
    );
  });
  it("Toene sind je Status identisch, unabhaengig von der Art", () => {
    expect(verfuegbarkeitPill("output", "verfuegbar").tone).toBe(
      verfuegbarkeitPill("biomasse", "verfuegbar").tone,
    );
  });
  it("Filter-Labels in normaler Orthographie", () => {
    expect(verfuegbarkeitLabel("biomasse", "vergeben_extern")).toBe(
      "Vergeben (extern)",
    );
    expect(verfuegbarkeitLabel("output", "verfuegbar")).toBe("Offen");
    expect(verfuegbarkeitLabel("biomasse", "noch_nicht_verfuegbar")).toBe(
      "Noch nicht verfügbar",
    );
  });
});

describe("vergabeLabel", () => {
  it("beide Enden gesetzt", () => {
    expect(vergabeLabel("2027-01-01", "2028-06-30")).toBe("01/2027 – 06/2028");
  });
  it("offenes von", () => {
    expect(vergabeLabel(null, "2028-06-30")).toBe("bis 06/2028");
  });
  it("offenes bis", () => {
    expect(vergabeLabel("2027-01-01", null)).toBe("ab 01/2027 (unbefristet)");
  });
});

const z = (o: Partial<VergabeFormZeile>): VergabeFormZeile => ({
  vonMonat: "",
  bisMonat: "",
  an: "",
  anBhyo: false,
  ...o,
});

describe("validiereVergaben", () => {
  it("leer und Leerzeilen sind gueltig", () => {
    expect(validiereVergaben("2026-01", "2030-12", [])).toEqual({});
    expect(validiereVergaben("2026-01", "2030-12", [z({})])).toEqual({});
  });

  it("bis vor von", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2028-01", bisMonat: "2027-01" }),
    ]);
    expect(f.vergabe_0_bis).toBe("Bis liegt vor Ab");
  });

  it("ausserhalb des Verfuegbarkeitszeitraums", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2025-06" }),
      z({ vonMonat: "2031-01", bisMonat: "2031-06" }),
    ]);
    expect(f.vergabe_0_von).toBe("Liegt vor dem Verfügbarkeitsbeginn");
    expect(f.vergabe_1_von).toBe("Liegt nach dem Verfügbarkeitsende");
    expect(f.vergabe_1_bis).toBe("Liegt nach dem Verfügbarkeitsende");
  });

  it("Ueberlappung zweier Zeitraeume", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ vonMonat: "2026-01", bisMonat: "2027-06" }),
      z({ vonMonat: "2027-06", bisMonat: "2028-01" }),
    ]);
    expect(f.vergabe_1_von).toBe(
      "Überschneidet sich mit einem anderen Vergabezeitraum",
    );
  });

  it("zwei offene Enden in dieselbe Richtung ueberlappen nach Normalisierung", () => {
    const f = validiereVergaben("2026-01", "2030-12", [
      z({ bisMonat: "2027-06" }),
      z({ bisMonat: "2028-06" }),
    ]);
    expect(f.vergabe_1_von).toBe(
      "Überschneidet sich mit einem anderen Vergabezeitraum",
    );
  });

  it("ueberlappungsfreie Zeitraeume inkl. offener Enden sind gueltig", () => {
    expect(
      validiereVergaben("2026-01", "2030-12", [
        z({ bisMonat: "2027-06" }),
        z({ vonMonat: "2027-07" }),
      ]),
    ).toEqual({});
  });
});

describe("vergabenZuWerten", () => {
  it("laesst Leerzeilen weg und normalisiert Monat -> Datum", () => {
    expect(
      vergabenZuWerten([
        z({}),
        z({ vonMonat: "2027-01", bisMonat: "2028-06", an: "  Stadtwerke  " }),
        z({ bisMonat: "2028-06", anBhyo: true }),
      ]),
    ).toEqual([
      {
        vergebenVon: "2027-01-01",
        vergebenBis: "2028-06-30",
        vergebenAn: "Stadtwerke",
        anBhyo: false,
      },
      {
        vergebenVon: null,
        vergebenBis: "2028-06-30",
        vergebenAn: null,
        anBhyo: true,
      },
    ]);
  });
});

describe("vergabenZuFormZeilen", () => {
  it("Datum -> Monat, null -> leer", () => {
    expect(
      vergabenZuFormZeilen([
        {
          vergebenVon: "2027-01-01",
          vergebenBis: null,
          vergebenAn: "X",
          anBhyo: true,
        },
      ]),
    ).toEqual([{ vonMonat: "2027-01", bisMonat: "", an: "X", anBhyo: true }]);
  });
});

describe("naechsteReserviertSeit", () => {
  it("Setzen stempelt heute", () => {
    expect(naechsteReserviertSeit(true, null, "2026-09-22")).toBe("2026-09-22");
  });
  it("Editieren stempelt nicht neu — die Zusage wird nicht verjuengt", () => {
    expect(naechsteReserviertSeit(true, "2026-03-01", "2026-09-22")).toBe(
      "2026-03-01",
    );
  });
  it("Abwaehlen nullt", () => {
    expect(naechsteReserviertSeit(false, "2026-03-01", "2026-09-22")).toBeNull();
  });
});

describe("istLeereVergabe", () => {
  it("beide Monate leer = Leerzeile, auch mit Text", () => {
    expect(istLeereVergabe(z({ an: "jemand" }))).toBe(true);
    expect(istLeereVergabe(z({ vonMonat: "2027-01" }))).toBe(false);
  });
});
