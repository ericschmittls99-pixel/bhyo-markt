import { describe, expect, it } from "vitest";

import { ORT_NORM_FAELLE, ORT_PASST_FAELLE, ORT_PRAEFIX_FAELLE, normalisiereOrt, ortNormPasst, ortNormPraefixe, ortPasst } from "./plz";

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

describe("Ortsteil-Toleranz (E72 e, Eric 08.10.2026): Formular und Import teilen diese eine Funktion", () => {
  it("„Mannheim-Neckarau“ zu 68199 (Mannheim) passt — Ort bleibt unveraendert, keine Meldung", () => {
    expect(ortPasst("Mannheim-Neckarau", "mannheim")).toBe(true);
    expect(ortPasst("Stuttgart Vaihingen", "stuttgart")).toBe(true);
    expect(ortNormPasst("mannheim neckarau", "mannheim")).toBe(true);
  });
  it("Rot: „Mannheimer Str.“ zu 68199 ist ein Befund (kein Wortende nach dem Ort)", () => {
    expect(ortPasst("Mannheimer Str.", "mannheim")).toBe(false);
    expect(ortPasst("Mannheimerstrasse", "mannheim")).toBe(false);
  });
  it("Rot: „Heidelberg-Rohrbach“ zu 68159 (Mannheim) passt nicht — „meinten Sie Mannheim?“ kommt aus der Pruefung", () => {
    expect(ortPasst("Heidelberg-Rohrbach", "mannheim")).toBe(false);
  });
  it.each(ORT_PRAEFIX_FAELLE)("Wortpraefixe von „%s“", (norm, erwartet) => {
    expect(ortNormPraefixe(norm)).toEqual(erwartet);
  });
  it("leere Normalformen passen nie (auch nicht leer zu leer)", () => {
    expect(ortNormPasst("", "")).toBe(false);
    expect(ortNormPasst("mannheim", "")).toBe(false);
  });
});
