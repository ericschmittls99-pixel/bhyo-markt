import { describe, expect, it } from "vitest";

import { istEindeutigkeitsVerletzung } from "./db-fehler";

describe("istEindeutigkeitsVerletzung", () => {
  it("erkennt den nackten postgres.js-Fehler", () => {
    expect(istEindeutigkeitsVerletzung(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
  });

  it("erkennt den in DrizzleQueryError eingepackten Fehler über cause", () => {
    const innen = Object.assign(new Error("dup"), { code: "23505" });
    expect(istEindeutigkeitsVerletzung(Object.assign(new Error("Failed query"), { cause: innen }))).toBe(true);
  });

  it("verwechselt andere Codes, Zahlen und Nicht-Objekte nicht damit", () => {
    expect(istEindeutigkeitsVerletzung(Object.assign(new Error("fk"), { code: "23503" }))).toBe(false);
    expect(istEindeutigkeitsVerletzung({ code: 23505 })).toBe(false);
    expect(istEindeutigkeitsVerletzung(null)).toBe(false);
    expect(istEindeutigkeitsVerletzung("23505")).toBe(false);
    expect(istEindeutigkeitsVerletzung(new Error("ohne code"))).toBe(false);
  });
});
