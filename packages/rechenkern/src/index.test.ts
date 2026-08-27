import { describe, expect, it } from "vitest";

import { RECHENKERN_VERSION } from "./index";

describe("rechenkern", () => {
  it("exportiert eine Version", () => {
    expect(RECHENKERN_VERSION).toBe("0.0.0");
  });
});
