/**
 * AP2.4 PR b (E62, Entscheidung Eric 01.10.2026): Pruefen und erneutes
 * Verifizieren setzen einen Beleg voraus — ohne Beleg wird SERVERSEITIG am
 * Eingang abgewiesen, bevor irgendetwas geschrieben wird. Die Actions werden
 * echt aufgerufen, Infrastruktur ist gemockt (Muster sperre-actions.test.ts).
 * Wird die Pruefung entfernt, laeuft das UPDATE durch — dann ist dieser Test
 * rot (einmal gezeigt, siehe PR).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let zeile: Record<string, unknown> = {};
let schreibversuche = 0;

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => "petra@bhyo.de",
  withDb: async (fn: (db: unknown) => unknown) => {
    const kette = (): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit", "leftJoin", "for", "orderBy"]) p[m] = () => kette();
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res([zeile]);
      return p;
    };
    const tx = {
      select: () => kette(),
      update: () => { schreibversuche += 1; throw new Error("Ohne Beleg darf nie geschrieben werden."); },
      insert: () => { schreibversuche += 1; throw new Error("Ohne Beleg darf nie geschrieben werden."); },
    };
    const db = { select: () => kette(), transaction: async (f: (t: unknown) => unknown) => f(tx) };
    return fn(db);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rechte/sperre-server", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/sperre-server")>();
  return { ...echt, pruefeStromSperre: async () => ({ gesperrtVon: null, zugewiesene: [], inhaber: null, gesperrtAm: null }) };
});

const { stromPruefen, stromReverifizieren } = await import("./stroeme-actions");

beforeEach(() => {
  // Dieselbe Zeile beantwortet die Wache (benutzer) und den Strom — beide lesen nur ihre Felder.
  zeile = { id: "00000000-0000-4000-8000-000000000001", rolle: "pruefer", aktiv: true, name: "Petra Prüfer", status: "in_pruefung", belegId: null };
  schreibversuche = 0;
});

describe("Ohne Beleg kann nicht geprueft werden (serverseitig, am Eingang)", () => {
  it("stromPruefen weist einen Strom ohne Beleg ab, ohne zu schreiben", async () => {
    const erg = await stromPruefen("biomasse", "s1");
    expect(erg).toEqual({ ok: false, fehler: "Ohne Beleg kann nicht geprüft werden." });
    expect(schreibversuche).toBe(0);
  });
  it("stromReverifizieren weist einen geprueften Strom ohne Beleg ab, ohne zu schreiben", async () => {
    zeile = { ...zeile, status: "geprueft" };
    const erg = await stromReverifizieren("output", "o1");
    expect(erg).toEqual({ ok: false, fehler: "Ohne Beleg kann nicht geprüft werden." });
    expect(schreibversuche).toBe(0);
  });
});
