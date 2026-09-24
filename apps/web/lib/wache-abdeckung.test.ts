/**
 * F8/E30: Dauerhafter Schutz gegen den MORGIGEN Schreibpfad.
 *
 * Die Rechtetests in `wache.test.ts` prüfen die heute vorhandenen Aktionen.
 * Dieser hier prüft, dass niemand eine neue anlegt und die Wache vergisst —
 * dieselbe Form wie der `step="any"`-Test: geprüft wird die Ursache
 * (fehlende Durchsetzung), nicht das Symptom.
 */
import { describe, expect, it } from "vitest";

import { findeLuecken } from "../scripts/wache-abdeckung";

describe("Wache-Abdeckung", () => {
  it("jede Server-Action und jede schreibende Route ruft die Wache auf", () => {
    const luecken = findeLuecken();
    // Aussagekräftige Meldung statt "expected 1 to be 0": Wer den Test rot
    // sieht, soll sofort wissen, welcher Pfad gemeint ist.
    expect(
      luecken.map((l) => `${l.datei} · ${l.pfad} — ${l.grund}`),
    ).toEqual([]);
  });
});
