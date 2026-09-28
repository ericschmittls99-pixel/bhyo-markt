import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * E39: Zeile 1 von auswertung. darf ihre Höhe nie ändern — mit und ohne
 * aktive Filter (Preview vorher: 52 px zu, 88 px offen, der Schalter rückte
 * 4 px hoch, Inhalt 36 px tiefer). Der Nachweis am Bildschirm steht im PR;
 * dieser Test hält die CSS-Vorgabe fest, die das trägt: feste Höhe und kein
 * Umbruch in der Kopfzeile. Wer sie lockert, sieht hier rot.
 */
function regelBlock(css: string, selektor: string): string {
  const i = css.indexOf(`${selektor} {`);
  if (i < 0) return "";
  return css.slice(i, css.indexOf("}", i));
}

describe("E39 Kopfzeile auswertung.: feste Höhe", () => {
  const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");
  const block = regelBlock(css, ".aw-kopfzeile");
  it("hat eine feste Höhe (nicht nur min-height)", () => {
    expect(block).toMatch(/\n\s*height:\s*var\(--toolbar-h\);/);
  });
  it("bricht nie um", () => {
    expect(block).toMatch(/flex-wrap:\s*nowrap;/);
  });
  it("die Filter-Chips stehen nicht in der Kopfzeile, sondern in der Zeile darunter", () => {
    const tsx = readFileSync(join(__dirname, "..", "components", "auswertung", "AuswertungToolbar.tsx"), "utf8");
    const kopf = tsx.slice(tsx.indexOf('className="st-toolbar aw-kopfzeile"'), tsx.indexOf("aw-kopfzeile-ende"));
    expect(kopf).not.toContain("<FacettenChips");
    expect(tsx).toContain("<FacettenChips");
  });
});
