import { describe, expect, it } from "vitest";

import { popoverKanten, popoverLage, type PopoverMasse } from "./popover-lage";

// Rückmeldung 1 (28.09.2026): Das Popover „Weitere Filter" ragte in ströme.
// über den rechten Rand (Preview, Fenster 1583 px: Anker 1429–1470, Popover
// 384 px breit → rechte Kante 1821). Die Lage muss in jedem Fenster passen.
const RAND = 8;
const passt = (m: PopoverMasse) => {
  const k = popoverKanten(m, popoverLage(m));
  return k.links >= RAND && k.rechts <= m.fensterBreite - RAND;
};

describe("popoverLage", () => {
  it("genug Platz rechts: öffnet links am Anker (unverändert)", () => {
    const l = popoverLage({ ankerLinks: 232, ankerRechts: 302, popBreite: 320, fensterBreite: 1280 });
    expect(l).toMatchObject({ seite: "links", versatz: 0 });
  });

  it("1280 px, Anker am rechten Rand: öffnet nach links (rechte Kante am Anker)", () => {
    const m = { ankerLinks: 1150, ankerRechts: 1190, popBreite: 400, fensterBreite: 1280 };
    const l = popoverLage(m);
    expect(l.seite).toBe("rechts");
    expect(passt(m)).toBe(true);
  });

  it("gemessener Fall der Preview (1583 px, Anker 1429–1470, 384 px)", () => {
    const m = { ankerLinks: 1429, ankerRechts: 1470, popBreite: 384, fensterBreite: 1583 };
    expect(popoverKanten(m, popoverLage(m)).rechts).toBeLessThanOrEqual(1583 - RAND);
  });

  it("schmales Fenster, Anker links: bleibt links, Breite gedeckelt", () => {
    const m = { ankerLinks: 16, ankerRechts: 60, popBreite: 400, fensterBreite: 360 };
    const l = popoverLage(m);
    expect(l.maxBreite).toBe(360 - 2 * RAND);
    expect(passt(m)).toBe(true);
  });

  it("schmales Fenster, Anker mittig: wird verschoben, bis es passt", () => {
    const m = { ankerLinks: 150, ankerRechts: 200, popBreite: 320, fensterBreite: 360 };
    const l = popoverLage(m);
    expect(l.versatz).toBeLessThan(0);
    expect(passt(m)).toBe(true);
  });

  it("Invariante: für jede Anker-/Fensterkombination liegt das Popover im Fenster", () => {
    for (const fensterBreite of [320, 360, 768, 1024, 1280, 1583, 1920]) {
      for (const popBreite of [240, 280, 320, 400]) {
        for (let ankerLinks = 0; ankerLinks < fensterBreite; ankerLinks += 37) {
          const m = { ankerLinks, ankerRechts: Math.min(ankerLinks + 44, fensterBreite), popBreite, fensterBreite };
          expect(passt(m), JSON.stringify(m)).toBe(true);
        }
      }
    }
  });
});
