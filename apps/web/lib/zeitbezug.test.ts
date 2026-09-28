import { describe, expect, it } from "vitest";

import type { Strom } from "./stroeme-modell";
import { fensterAusJahren, leseZeitbezug, zeitbezugText } from "./zeitbezug";

const pool = [
  { zeitraumVon: "2024-01-01", zeitraumBis: "2028-12-31" },
  { zeitraumVon: "2026-01-01", zeitraumBis: "2027-06-30" },
] as Strom[];

describe("Zeitbezug (herausgezogen fuer Seite und Export, Logik unveraendert)", () => {
  it("Einzeljahr: Default aktuelles Jahr, gewaehltes Jahr nur auf der Achse", () => {
    expect(leseZeitbezug({}, pool, 2026).jahre).toEqual([2026]);
    expect(leseZeitbezug({ jahre: "2027" }, pool, 2026).jahre).toEqual([2027]);
    expect(leseZeitbezug({ jahre: "2099" }, pool, 2026).jahre).toEqual([2026]);
  });
  it("Zeitraum: gewaehlte Jahre, sonst ganze Achse; Summe nur im Zeitraum", () => {
    expect(leseZeitbezug({ zeitmodus: "zeitraum" }, pool, 2026).jahre).toEqual([2024, 2025, 2026, 2027, 2028]);
    expect(leseZeitbezug({ zeitmodus: "zeitraum", jahre: "2025,2026", agg: "summe" }, pool, 2026)).toMatchObject({
      jahre: [2025, 2026],
      agg: "summe",
    });
    expect(leseZeitbezug({ agg: "summe" }, pool, 2026).agg).toBe("oe");
  });
  it("Fenster und Wortlaut", () => {
    expect(fensterAusJahren([2025, 2026])).toEqual({ von: "2025-01-01", bis: "2026-12-31" });
    expect(zeitbezugText({ zeitmodus: "einzeljahr", jahre: [2026] })).toBe("Jahr 2026");
    expect(zeitbezugText({ zeitmodus: "zeitraum", jahre: [2022, 2023, 2026] })).toBe("Zeitraum 2022 bis 2026");
  });
});
