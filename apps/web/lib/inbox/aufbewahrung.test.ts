/**
 * AP2.6 PR d (E71 Punkt 9, D14): Die Aufbewahrung als EIN Statement mit den
 * zwei Parametern am Stichtag; die zustandsbasierten Hinweise des Jobs sind
 * ausgenommen — und genau die Typen, die das Register als nicht
 * ereignisgetrieben fuehrt (ausser import_abgeschlossen, das der Import
 * einmal zustellt). Die Tagesgrenzen prueft die Probe gegen die Wegwerf-DB.
 */
import { describe, expect, it } from "vitest";

import { JOB_HINWEIS_TYPEN, PARAMETER_ERLEDIGT, PARAMETER_GELESEN, raeumeInboxAuf } from "./aufbewahrung";
import { INBOX_TYPEN, type InboxTyp } from "./register";

describe("raeumeInboxAuf (D14)", () => {
  it("ein Statement: zwei Parameter am Stichtag, erledigt/verworfen nach zustand_seit, offen+gelesen nach gelesen_am, Job-Hinweise ausgenommen", async () => {
    const ausgefuehrt: string[] = [];
    const db = {
      execute: async (q: { queryChunks?: unknown[] }) => {
        const texte = (o: unknown, seen = new Set<object>()): string[] => {
          if (!o || typeof o !== "object" || seen.has(o)) return [];
          seen.add(o);
          return Object.values(o as Record<string, unknown>).flatMap((v) => (typeof v === "string" ? [v] : texte(v, seen)));
        };
        ausgefuehrt.push(texte(q).join(" "));
        return [{ erledigt: 3, gelesen: 1 }];
      },
    };
    const erg = await raeumeInboxAuf(db as never, "2026-10-08");
    expect(erg).toEqual({ erledigt: 3, gelesen: 1 });
    expect(ausgefuehrt).toHaveLength(1);
    const q = ausgefuehrt[0]!;
    expect(q).toContain(PARAMETER_ERLEDIGT);
    expect(q).toContain(PARAMETER_GELESEN);
    expect(q).toContain("zustand in ('erledigt', 'verworfen')");
    expect(q).toContain("zustand = 'offen'");
    expect(q).toContain("gelesen_am is not null");
    expect(q).toContain("at time zone 'Europe/Berlin'");
    expect(q).toContain("2026-10-08");
    for (const t of JOB_HINWEIS_TYPEN) expect(q).toContain(t);
    expect(q.match(/delete from inbox_eintrag/g)?.length).toBe(2);
  });
  it("die Ausnahmeliste ist genau die Menge der zustandsbasierten Register-Typen (arten leer) ohne import_abgeschlossen", () => {
    const zustandsbasiert = (Object.entries(INBOX_TYPEN) as [InboxTyp, { arten: readonly unknown[] }][])
      .filter(([typ, def]) => def.arten.length === 0 && typ !== "import_abgeschlossen")
      .map(([typ]) => typ)
      .sort();
    expect([...JOB_HINWEIS_TYPEN].sort()).toEqual(zustandsbasiert);
  });
});
