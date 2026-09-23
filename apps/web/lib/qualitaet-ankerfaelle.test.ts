import { describe, expect, it } from "vitest";

import { ANKERFAELLE } from "./qualitaet-ankerfaelle";
import { deriveQualitaet } from "./qualitaet";

// E23: die TS-Haelfte der Paritaet. Die DB-Haelfte (qualitaetsstufe() aus
// Migration 0013 gegen dieselben Ankerfaelle) laeuft im Deploy-CI ueber
// scripts/qualitaet-paritaet.ts — dort mit echter DB, nicht mit einem Mock.
describe("Ankerfaelle – deriveQualitaet", () => {
  it.each(ANKERFAELLE.map((a) => [a.name, a] as const))("%s", (_n, a) => {
    expect(deriveQualitaet(a.bewertung)).toBe(a.erwartet);
  });
});
