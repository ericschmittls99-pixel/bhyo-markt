import { describe, expect, it } from "vitest";

import {
  leiteVerfuegbarkeitAb,
  vergabeLabel,
  type VergabeDaten,
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
    ).toEqual({ status: "abgelaufen", reserviertZusatz: false });
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

  it("nach Vergabe-Ende faellt der Strom auf die Reservierung zurueck", () => {
    expect(
      leiteVerfuegbarkeitAb("2028-07-01", { ...strom, reserviertBhyo: true }, [
        v({ vergebenVon: "2027-01-01", vergebenBis: "2028-06-30" }),
      ]).status,
    ).toBe("reserviert_bhyo");
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
