import { describe, expect, it } from "vitest";

import { fmtZahlungsstrom } from "./format";

describe("fmtZahlungsstrom", () => {
  it("leitet das Label aus dem Vorzeichen ab (E14): positiv = Einkauf, negativ = Annahme", () => {
    expect(fmtZahlungsstrom(12)).toBe("Einkaufspreis 12 €/t");
    expect(fmtZahlungsstrom(-8.5)).toBe("Annahmeentgelt 8,50 €/t");
    expect(fmtZahlungsstrom(0)).toBe("Einkaufspreis 0 €/t");
  });
});
