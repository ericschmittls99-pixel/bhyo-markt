/**
 * AP2.7 PR a (E67): Rot zeigen — ein Bearbeiter startet einen Import und wird
 * abgewiesen, bevor irgendetwas geschrieben wird. Die Action wird echt
 * aufgerufen, Infrastruktur ist gemockt (Muster stroeme-actions.beleg.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let rolle = "bearbeiter";
let schreibversuche = 0;
const protokolle: unknown[] = [];

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => "petra@bhyo.de",
  withDb: async (fn: (db: unknown) => unknown) => {
    const tx = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
      insert: () => ({ values: () => ({ returning: async () => { schreibversuche += 1; return [{ id: "lauf-1" }]; } }) }),
    };
    const kette = (): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit"]) p[m] = () => kette();
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res([{ id: "u1", rolle, aktiv: true, name: "Petra" }]);
      return p;
    };
    return fn({ select: () => kette(), transaction: async (f: (t: unknown) => unknown) => f(tx) });
  },
}));
vi.mock("@/lib/protokoll", () => ({ protokolliere: async (_tx: unknown, e: unknown) => { protokolle.push(e); return { id: "e1" }; } }));

const { importLaufAnlegen } = await import("./import-actions");

const eingabe = { art: "biomasse", dateiname: "stroeme-2026.xlsx", dateiHash: "a".repeat(64), belegTyp: "betriebsdaten", standardSektor: "ohne_sektor" };

beforeEach(() => { schreibversuche = 0; protokolle.length = 0; });

describe("importLaufAnlegen (import.ausfuehren)", () => {
  it("Rot: ein Bearbeiter wird abgewiesen, nichts wird geschrieben", async () => {
    rolle = "bearbeiter";
    const erg = await importLaufAnlegen(eingabe);
    expect(erg.ok).toBeUndefined();
    expect(erg.fehler).toMatch(/recht/i);
    expect(schreibversuche).toBe(0);
    expect(protokolle).toHaveLength(0);
  });

  it("ein Pruefer legt den Lauf an; das Ereignis traegt die Lauf-ID", async () => {
    rolle = "pruefer";
    const erg = await importLaufAnlegen(eingabe);
    expect(erg).toMatchObject({ ok: true, id: "lauf-1" });
    expect(schreibversuche).toBe(1);
    expect(protokolle[0]).toMatchObject({ art: "angelegt", entitaet: "import_lauf", id: "lauf-1", importLaufId: "lauf-1" });
  });

  it("unvollstaendige Eingabe wird vor jeder Wirkung abgewiesen", async () => {
    rolle = "admin";
    const erg = await importLaufAnlegen({ ...eingabe, dateiHash: "kein-hash", belegTyp: "" });
    expect(erg.feldFehler).toMatchObject({ dateiHash: expect.any(String), belegTyp: expect.any(String) });
    expect(schreibversuche).toBe(0);
  });
});
