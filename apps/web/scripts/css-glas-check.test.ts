import { describe, expect, it } from "vitest";

import { pruefeGlas, zaehleBackdrop } from "./css-glas-check";

// Befund 12.10.2026: der Build gab nur -webkit-backdrop-filter aus — Rot-Fall.
describe("css-glas-check", () => {
  it("zaehlt unpraefixte und -webkit-Vorkommen getrennt", () => {
    expect(zaehleBackdrop(".a{backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}")).toEqual({ unpraefixt: 1, webkit: 1 });
    expect(zaehleBackdrop(".a{-webkit-backdrop-filter:blur(2px)}")).toEqual({ unpraefixt: 0, webkit: 1 });
    expect(zaehleBackdrop(".a{color:red}")).toEqual({ unpraefixt: 0, webkit: 0 });
  });
  it("ROT: nur -webkit- im Build (der Befund)", () => {
    expect(pruefeGlas([{ datei: "x.css", unpraefixt: 3, webkit: 18 }])).toEqual(["x.css: 18 -webkit-, nur 3 unpraefixt"]);
    expect(pruefeGlas([{ datei: "x.css", unpraefixt: 0, webkit: 0 }])).toEqual(["kein unpraefixtes backdrop-filter im Build"]);
  });
  it("GRUEN: unpraefixt mindestens so oft wie -webkit-", () => {
    expect(pruefeGlas([{ datei: "x.css", unpraefixt: 18, webkit: 18 }, { datei: "y.css", unpraefixt: 2, webkit: 0 }])).toEqual([]);
  });
});
