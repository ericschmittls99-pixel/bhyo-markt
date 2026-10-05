/**
 * AP2.5 PR c: das TypeScript-Spiegelbild von akteur_name_norm und similarity
 * gegen die gemeinsamen Fixtures (@bhyo/db/dubletten-fixtures) — die SQL-
 * Seite prueft dubletten-check in der CI. Die Trigramm-Referenz stammt aus
 * der pg_trgm-Dokumentation (show_trgm('word'), similarity('word','two words')).
 */
import { AEHNLICHKEIT_FIXTURES, NORM_FIXTURES } from "@bhyo/db/dubletten-fixtures";
import { describe, expect, it } from "vitest";

import { aehnlichkeit, akteurNameNorm, DUBLETTE_SCHWACH, DUBLETTE_STARK, dublettenGrad, trigramme, wortTeilmenge } from "./akteur-norm";

describe("akteurNameNorm (Spiegelbild von akteur_name_norm, Migration 0038)", () => {
  for (const [eingabe, erwartet] of NORM_FIXTURES) {
    it(`${JSON.stringify(eingabe)} → ${JSON.stringify(erwartet)}`, () => {
      expect(akteurNameNorm(eingabe)).toBe(erwartet);
    });
  }
  it("ist idempotent", () => {
    for (const [, erwartet] of NORM_FIXTURES) expect(akteurNameNorm(erwartet)).toBe(erwartet);
  });
});

describe("Trigramme und Aehnlichkeit wie pg_trgm", () => {
  it("show_trgm('word') = {'  w',' wo','wor','ord','rd '}", () => {
    expect([...trigramme("word")].sort()).toEqual(["  w", " wo", "ord", "rd ", "wor"].sort());
  });
  for (const [a, b, erwartet] of AEHNLICHKEIT_FIXTURES) {
    it(`similarity(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${erwartet}`, () => {
      expect(aehnlichkeit(a, b)).toBeCloseTo(erwartet, 9);
      expect(aehnlichkeit(b, a)).toBeCloseTo(erwartet, 9);
    });
  }
});

describe("dublettenGrad", () => {
  it("stark braucht Aehnlichkeit UND Ortsbezug; schwach nur Aehnlichkeit; darunter nichts", () => {
    expect(DUBLETTE_SCHWACH).toBeGreaterThanOrEqual(DUBLETTE_STARK);
    expect(dublettenGrad(1, true)).toBe("stark");
    expect(dublettenGrad(1, false)).toBe("schwach");
    expect(dublettenGrad(DUBLETTE_STARK, true)).toBe("stark");
    expect(dublettenGrad(DUBLETTE_STARK, false)).toBe(DUBLETTE_STARK >= DUBLETTE_SCHWACH ? "schwach" : null);
    expect(dublettenGrad(DUBLETTE_SCHWACH, false)).toBe("schwach");
    expect(dublettenGrad(DUBLETTE_STARK - 0.01, true)).toBeNull();
    expect(dublettenGrad(0, false)).toBeNull();
  });
});

describe("wortTeilmenge (Zusatzregel, Spiegelbild von akteur_name_wortteilmenge)", () => {
  it("kuerzerer Name mit >= 2 Woertern, alle im laengeren enthalten", () => {
    expect(wortTeilmenge("avr rhein neckar", "avr abfallverwertung rhein neckar")).toBe(true);
    expect(wortTeilmenge("avr abfallverwertung rhein neckar", "avr rhein neckar")).toBe(true);
    expect(wortTeilmenge("mueller agrar", "mueller agrar")).toBe(true);
  });
  it("ein Wort reicht nicht; Teilwoerter zaehlen nicht; leer nie", () => {
    expect(wortTeilmenge("speyer", "stadtwerke speyer")).toBe(false);
    expect(wortTeilmenge("stadt speyer", "stadtwerke speyer")).toBe(false);
    expect(wortTeilmenge("", "stadtwerke speyer")).toBe(false);
    expect(wortTeilmenge("", "")).toBe(false);
  });
  it("mit Ortsbezug stark unabhaengig von der Aehnlichkeit; ohne Ortsbezug ohne Wirkung", () => {
    expect(dublettenGrad(0.3, true, true)).toBe("stark");
    expect(dublettenGrad(0.3, false, true)).toBeNull();
    expect(dublettenGrad(0.3, true, false)).toBeNull();
  });
});
