import { describe, expect, it } from "vitest";

import { JOB_STUNDE_BERLIN, berlinStunde, istBerlinStunde } from "./zeit";

// AP2.4 PR b: Zwei Cron-Zeiten (03:00, 04:00 UTC), genau eine davon ist 05:00
// Berlin — vor, an und nach beiden Umstellungstagen 2026 (29.03., 25.10.).
describe("Berliner Stunde des Jobs", () => {
  const faelle: [string, boolean][] = [
    // Winterzeit (UTC+1): 04:00 UTC = 05:00 Berlin
    ["2026-03-28T03:00:00Z", false],
    ["2026-03-28T04:00:00Z", true],
    // Umstellungstag 29.03.2026 (ab 01:00 UTC Sommerzeit, UTC+2): 03:00 UTC = 05:00 Berlin
    ["2026-03-29T03:00:00Z", true],
    ["2026-03-29T04:00:00Z", false],
    // Sommerzeit
    ["2026-07-01T03:00:00Z", true],
    ["2026-07-01T04:00:00Z", false],
    // Letzter Sommerzeit-Tag und Umstellungstag 25.10.2026 (ab 01:00 UTC Winterzeit)
    ["2026-10-24T03:00:00Z", true],
    ["2026-10-24T04:00:00Z", false],
    ["2026-10-25T03:00:00Z", false],
    ["2026-10-25T04:00:00Z", true],
    ["2026-12-01T04:00:00Z", true],
  ];
  it.each(faelle)("%s → 05:00 Berlin: %s", (iso, erwartet) => {
    expect(istBerlinStunde(new Date(iso), JOB_STUNDE_BERLIN)).toBe(erwartet);
  });
  it("an jedem Tag faellt genau einer der beiden Cron-Aufrufe auf 05:00 Berlin", () => {
    for (let tag = 0; tag < 365; tag++) {
      const d = new Date(Date.UTC(2026, 0, 1 + tag));
      const treffer = [3, 4].filter((h) => istBerlinStunde(new Date(d.getTime() + h * 3_600_000), JOB_STUNDE_BERLIN));
      expect(treffer).toHaveLength(1);
    }
  });
  it("berlinStunde liefert 0–23 (Mitternacht ist 0, nicht 24)", () => {
    expect(berlinStunde(new Date("2026-07-01T22:00:00Z"))).toBe(0);
    expect(berlinStunde(new Date("2026-01-01T23:00:00Z"))).toBe(0);
  });
});
