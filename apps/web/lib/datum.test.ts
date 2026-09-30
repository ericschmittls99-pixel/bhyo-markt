import { describe, expect, it } from "vitest";

import { heuteBerlin, kalendertag, ZEITZONE } from "./datum";

// AP2.3 PR b: Basisdatum = Kalendertag Europe/Berlin, nicht UTC.
describe("kalendertag (Europe/Berlin)", () => {
  it("Tageswechsel vor UTC: 22:30Z im Sommer ist schon der naechste Tag", () => {
    expect(kalendertag(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01");
    expect(kalendertag(new Date("2026-09-30T21:30:00Z"))).toBe("2026-09-30");
  });
  it("im Winter (UTC+1): 23:30Z ist schon Neujahr", () => {
    expect(kalendertag(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(kalendertag(new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31");
  });
  it("ein Erhebungsdatum aus dem Formular (UTC-Mitternacht gespeichert) bleibt derselbe Tag", () => {
    // lib/beleg-server.ts speichert new Date("JJJJ-MM-TT") = 00:00Z; in
    // Berlin ist das 01:00/02:00 desselben Tages — kein Sprung.
    expect(kalendertag(new Date("2026-03-29"))).toBe("2026-03-29");
    expect(kalendertag(new Date("2026-10-25"))).toBe("2026-10-25");
  });
  it("heuteBerlin ist derselbe Kalendertag", () => {
    const jetzt = new Date("2026-09-30T22:30:00Z");
    expect(heuteBerlin(jetzt)).toBe(kalendertag(jetzt));
    expect(ZEITZONE).toBe("Europe/Berlin");
  });
});
