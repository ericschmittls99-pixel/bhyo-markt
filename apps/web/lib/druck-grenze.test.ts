import { describe, expect, it } from "vitest";

import { DRUCK_OBERGRENZE, druckErlaubt, druckHinweis, grenzeAusgesetzt } from "./druck-grenze";

describe("Druck-Obergrenze", () => {
  it("erlaubt bis zur Grenze, darüber nicht", () => {
    expect(druckErlaubt(0)).toBe(true);
    expect(druckErlaubt(DRUCK_OBERGRENZE)).toBe(true);
    expect(druckErlaubt(DRUCK_OBERGRENZE + 1)).toBe(false);
    expect(druckErlaubt(128)).toBe(false);
  });
  it("der Hinweis nennt Anzahl, Grenze und den Ausweg", () => {
    const h = druckHinweis(128);
    expect(h).toContain("128");
    expect(h).toContain(String(DRUCK_OBERGRENZE));
    expect(h).toMatch(/Filter setzen/);
    expect(h).toMatch(/CSV/);
  });
  it("Testschalter gilt nur auf der Preview", () => {
    expect(grenzeAusgesetzt("aus", "preview")).toBe(true);
    expect(grenzeAusgesetzt("aus", "production")).toBe(false);
    expect(grenzeAusgesetzt("aus", "development")).toBe(false);
    expect(grenzeAusgesetzt(null, "preview")).toBe(false);
    expect(grenzeAusgesetzt("an", "preview")).toBe(false);
  });
});
