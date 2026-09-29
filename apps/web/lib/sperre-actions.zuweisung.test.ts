/**
 * Rückfrage Eric (29.09.2026, PR #116): `stromZuweisen` schreibt mit
 * ON CONFLICT DO NOTHING. Fügt die Datenbank 0 Zeilen ein (schon zugewiesen),
 * darf die Aktion nicht still Erfolg melden und kein „zugewiesen"-Protokoll
 * schreiben — sie meldet „ist bereits zugewiesen". Die Aktion wird echt
 * aufgerufen; Datenbank und Sperrprüfung sind Attrappen, die Sperre lässt
 * hier durch (Fall „nicht gesperrt").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NUTZER = { id: "00000000-0000-4000-8000-000000000001", rolle: "pruefer" as const, aktiv: true, name: "Petra Prüfer", email: "petra@bhyo.de" };
const ZIEL = { id: "00000000-0000-4000-8000-000000000002", rolle: "bearbeiter" as const, aktiv: true, name: "Bernd Bearbeiter", email: "bernd@bhyo.de" };

/** Was das INSERT der Zuweisung per RETURNING liefert: [] = Konflikt, nichts eingefügt. */
let eingefuegt: { id: string }[] = [];
let protokoll: unknown[] = [];

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => NUTZER.email,
  withDb: async (fn: (db: unknown) => unknown) => {
    const kette = (zeilen: unknown[]): unknown => {
      const p: Record<string, unknown> = {};
      for (const m of ["from", "where", "limit"]) p[m] = () => kette(zeilen);
      (p as { then: unknown }).then = (res: (v: unknown) => void) => res(zeilen);
      return p;
    };
    // Die Wache liest den Handelnden außerhalb der Transaktion (db.select),
    // die Aktion das Ziel in der Transaktion (tx.select).
    const tx = {
      select: () => kette([ZIEL]),
      insert: (tabelle: { _?: { name?: string } } & Record<string, unknown>) => ({
        values: (werte: unknown) => {
          const istProtokoll = typeof werte === "object" && werte !== null && "text" in werte;
          if (istProtokoll) protokoll.push(werte);
          const ergebnis = Promise.resolve(undefined) as Promise<unknown> & Record<string, unknown>;
          ergebnis.onConflictDoNothing = () => ({ returning: async () => eingefuegt });
          // Das Protokoll (lib/protokoll) liest die Ereignis-ID per RETURNING.
          ergebnis.returning = async () => [{ id: "e1" }];
          return ergebnis;
        },
      }),
    };
    const db = { select: () => kette([NUTZER]), transaction: async (f: (t: unknown) => unknown) => f(tx) };
    return fn(db);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/inbox/zustellung", () => ({ zustellen: async () => 0 }));
vi.mock("@/lib/rechte/sperre-server", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/sperre-server")>();
  return { ...echt, pruefeStromSperre: async () => {} };
});

const { stromZuweisen } = await import("./sperre-actions");

beforeEach(() => {
  eingefuegt = [];
  protokoll = [];
});

describe("stromZuweisen und ON CONFLICT DO NOTHING", () => {
  it("meldet Erfolg und protokolliert, wenn die Zuweisung wirklich eingefügt wurde", async () => {
    eingefuegt = [{ id: "z1" }];
    await expect(stromZuweisen("biomasse", "s1", ZIEL.id)).resolves.toEqual({ ok: true });
    expect(protokoll).toHaveLength(1);
    // PR c: die Freischaltung geht an den Zugewiesenen — das Protokoll traegt ihn nicht als Spalte,
    // die Zustellung bekommt ihn ueber betrifftId (siehe zustellung.zugriff.test.ts).
  });

  it("meldet „ist bereits zugewiesen“, wenn 0 Zeilen eingefügt wurden — ohne Protokolleintrag", async () => {
    eingefuegt = [];
    const erg = await stromZuweisen("biomasse", "s1", ZIEL.id);
    expect(erg.ok).toBe(false);
    expect(erg.fehler).toBe("Bernd Bearbeiter ist bereits zugewiesen.");
    expect(protokoll).toEqual([]);
  });
});
