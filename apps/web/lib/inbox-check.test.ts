import { describe, expect, it } from "vitest";

import { findeLuecken } from "../scripts/inbox-check";

describe("inbox-check", () => {
  it("inbox_eintrag wird ausschließlich in lib/inbox geschrieben", () => {
    expect(findeLuecken().map((l) => `${l.datei} · ${l.pfad} — ${l.grund}`)).toEqual([]);
  });
});
