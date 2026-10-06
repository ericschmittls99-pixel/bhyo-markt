import { describe, expect, it } from "vitest";

import { ORT_NORM_FAELLE, ORT_PASST_FAELLE, normalisiereOrt, ortPasst } from "./plz";

describe("normalisiereOrt (E68 PR 1, Spiegel von plz_ort_norm)", () => {
  it.each(ORT_NORM_FAELLE)("„%s“ -> „%s“", (eingabe, erwartet) => {
    expect(normalisiereOrt(eingabe)).toBe(erwartet);
  });
});

describe("ortPasst (Spiegel von plz_ort_passt)", () => {
  it.each(ORT_PASST_FAELLE)("„%s“ zu „%s“ -> %s", (eingabe, ortNorm, erwartet) => {
    expect(ortPasst(eingabe, ortNorm)).toBe(erwartet);
  });

  it("Rot: Tippfehler oder fremder Ort passen nicht — die Orte der PLZ sind dann der Vorschlag", () => {
    expect(ortPasst("Speier", "speyer")).toBe(false);
    expect(ortPasst("Mannheim", "ludwigshafen am rhein")).toBe(false);
  });
});
