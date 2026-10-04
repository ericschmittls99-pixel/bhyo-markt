import { describe, expect, it } from "vitest";

import { systemzeileRegel } from "./sektor-regel";

describe("sektor-check Regel (3): geschuetzte Codes und Journal-Modus", () => {
  it("gleiches Journal: keine geschuetzte Zeile → ok", () => {
    expect(systemzeileRegel("exakt", [])).toEqual({ fehler: null, hinweis: null });
  });
  it("gleiches Journal + Zeile ohne_sektor → rot, aus diesem Grund", () => {
    const r = systemzeileRegel("exakt", ["ohne_sektor"]);
    expect(r.fehler).toMatch(/ohne_sektor/);
    expect(r.fehler).toMatch(/gleiches Journal/);
  });
  it("DB voraus + Zeile ohne_sektor → toleriert, und die Ausgabe sagt es ausdruecklich", () => {
    const r = systemzeileRegel("mindest", ["ohne_sektor"]);
    expect(r.fehler).toBeNull();
    expect(r.hinweis).toMatch(/^DB voraus – ohne_sektor .*toleriert$/);
  });
  it("abnehmer ist in jedem Modus rot", () => {
    expect(systemzeileRegel("mindest", ["abnehmer", "ohne_sektor"]).fehler).toMatch(/abnehmer/);
    expect(systemzeileRegel("exakt", ["abnehmer"]).fehler).toMatch(/abnehmer/);
  });
  it("Journal rot → Zeile ohne_sektor bleibt rot (kein stilles Tolerieren)", () => {
    expect(systemzeileRegel("rot", ["ohne_sektor"]).fehler).not.toBeNull();
  });
});
