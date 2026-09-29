/**
 * AP2.2 PR a: Dauerhafter Schutz gegen den MORGIGEN Schreibpfad ohne
 * Ereignis — und gegen den zweiten Schreibweg ins Protokoll. Gleiche Form
 * wie rechte-check.test.ts: geprüft wird die Ursache, nicht das Symptom.
 */
import { describe, expect, it } from "vitest";

import { findeLuecken } from "../scripts/protokoll-check";

describe("protokoll-check", () => {
  it("lib/protokoll ist die einzige Schreibstelle und jeder Schreibpfad protokolliert mit einer Art", () => {
    expect(findeLuecken().map((l) => `${l.datei} · ${l.pfad} — ${l.grund}`)).toEqual([]);
  });
});
