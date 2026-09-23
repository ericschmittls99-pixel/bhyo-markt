import { describe, expect, it } from "vitest";

import { erstelleRateLimit } from "./rate-limit";

describe("erstelleRateLimit", () => {
  it("erlaubt bis zum Limit im Fenster, dann nicht mehr", () => {
    const erlaubt = erstelleRateLimit(3, 10_000);
    expect(erlaubt("a", 0)).toBe(true);
    expect(erlaubt("a", 1_000)).toBe(true);
    expect(erlaubt("a", 2_000)).toBe(true);
    expect(erlaubt("a", 3_000)).toBe(false);
  });

  it("setzt im naechsten Fenster zurueck und trennt Schluessel", () => {
    const erlaubt = erstelleRateLimit(1, 10_000);
    expect(erlaubt("a", 0)).toBe(true);
    expect(erlaubt("b", 0)).toBe(true);
    expect(erlaubt("a", 5_000)).toBe(false);
    expect(erlaubt("a", 10_001)).toBe(true);
  });
});
