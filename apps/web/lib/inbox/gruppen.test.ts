import { describe, expect, it } from "vitest";

import { gruppiere, tagVon } from "./gruppen";

const z = (id: string, typ: string, iso: string) => ({ id, typ: typ as never, aktualisiertAm: iso });

describe("E77 R5: gruppiere", () => {
  it("fasst gleiche Typen desselben Tages zusammen, laesst Einzelne stehen und haelt die Reihenfolge", () => {
    const erg = gruppiere([
      z("a", "verifikation_abgelaufen", "2026-10-13T08:00:00.000Z"),
      z("b", "kommentar", "2026-10-13T07:30:00.000Z"),
      z("c", "verifikation_abgelaufen", "2026-10-13T06:00:00.000Z"),
      z("d", "verifikation_abgelaufen", "2026-10-12T06:00:00.000Z"),
    ]);
    expect(erg.map((e) => e.art)).toEqual(["gruppe", "einzeln", "einzeln"]);
    const g = erg[0]!;
    if (g.art !== "gruppe") throw new Error("erwartet Gruppe");
    expect(g.typ).toBe("verifikation_abgelaufen");
    expect(g.tag).toBe("2026-10-13");
    expect(g.zeilen.map((x) => x.id)).toEqual(["a", "c"]);
    expect(erg[2]).toMatchObject({ art: "einzeln", zeile: { id: "d" } });
  });

  it("rechnet den Tag in Europe/Berlin, nicht in UTC", () => {
    // 22:30 UTC am 12.10. ist 00:30 Uhr Berlin am 13.10. — gehoert zum 13.10.
    expect(tagVon("2026-10-12T22:30:00.000Z")).toBe("2026-10-13");
    expect(tagVon("2026-10-12T21:30:00.000Z")).toBe("2026-10-12");
    expect(tagVon("kein datum")).toBe("");
    const erg = gruppiere([z("a", "kommentar", "2026-10-12T22:30:00.000Z"), z("b", "kommentar", "2026-10-13T05:00:00.000Z")]);
    expect(erg).toHaveLength(1);
    expect(erg[0]!.art).toBe("gruppe");
  });

  it("leer bleibt leer; zwei Typen am selben Tag bleiben getrennt", () => {
    expect(gruppiere([])).toEqual([]);
    const erg = gruppiere([z("a", "kommentar", "2026-10-13T05:00:00.000Z"), z("b", "erwaehnung", "2026-10-13T05:00:00.000Z")]);
    expect(erg.map((e) => e.art)).toEqual(["einzeln", "einzeln"]);
  });
});
