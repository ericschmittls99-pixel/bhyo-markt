/**
 * AP2.2 PR a: Dauerhafter Schutz gegen den MORGIGEN Schreibpfad ohne
 * Ereignis — und gegen den zweiten Schreibweg ins Protokoll. Gleiche Form
 * wie rechte-check.test.ts: geprüft wird die Ursache, nicht das Symptom.
 */
import { describe, expect, it } from "vitest";

import { AUSNAHMEN, findeLuecken } from "../scripts/protokoll-check";
import { schreibpfade } from "../scripts/schreibpfade";

describe("protokoll-check", () => {
  it("die Ausnahmen sind genau die fuenf Inbox-Aktionen, jede ein vorhandener Schreibpfad — kein Platzhalter", () => {
    const pfade = new Set(schreibpfade(process.cwd()).map((p) => `${p.datei} · ${p.pfad}`));
    expect([...AUSNAHMEN].sort()).toEqual(
      [
        "lib/inbox/actions.ts · inboxGelesen()",
        "lib/inbox/actions.ts · inboxUngelesen()",
        "lib/inbox/actions.ts · inboxErledigen()",
        "lib/inbox/actions.ts · inboxVerwerfen()",
        "lib/inbox/actions.ts · inboxAlleErledigen()",
      ].sort(),
    );
    for (const a of AUSNAHMEN) expect(pfade.has(a)).toBe(true);
  });

  it("lib/protokoll ist die einzige Schreibstelle und jeder Schreibpfad protokolliert mit einer Art", () => {
    expect(findeLuecken().map((l) => `${l.datei} · ${l.pfad} — ${l.grund}`)).toEqual([]);
  });
});
