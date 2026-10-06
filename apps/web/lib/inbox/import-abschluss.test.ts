/**
 * AP2.7 PR c (E67): import_abgeschlossen — ein Eintrag je Lauf an alle aktiven
 * Pruefer und Admins, gebuendelt ueber den partiellen Unique-Index (Konflikt
 * erhoeht anzahl, setzt ungelesen). Attrappe der Transaktion; geprueft werden
 * Empfaengerwahl, Werte und das Konfliktziel.
 */
import { describe, expect, it } from "vitest";

import { stelleImportAbschlussZu } from "./zustellung";

function fakeTx(benutzerZeilen: { id: string }[]) {
  const inserts: Record<string, unknown>[] = [];
  const konflikte: Record<string, unknown>[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: async () => benutzerZeilen }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v);
        return { onConflictDoUpdate: async (k: Record<string, unknown>) => void konflikte.push(k) };
      },
    }),
  };
  return { tx: tx as never, inserts, konflikte };
}

describe("stelleImportAbschlussZu", () => {
  it("ein Eintrag je aktivem Pruefer/Admin, Typ import_abgeschlossen mit Lauf-ID, Konflikt auf (Empfaenger, Typ, Lauf) buendelt", async () => {
    const { tx, inserts, konflikte } = fakeTx([{ id: "p1" }, { id: "a1" }]);
    const n = await stelleImportAbschlussZu(tx, { importLaufId: "lauf-1", ausloeserId: "p1", ereignisId: "e1", importiert: 42 });
    expect(n).toBe(2);
    expect(inserts.map((i) => i.empfaengerId)).toEqual(["p1", "a1"]);
    expect(inserts[0]).toMatchObject({ typ: "import_abgeschlossen", importLaufId: "lauf-1", ereignisId: "e1", ausloeserId: "p1", anzahl: 42, zustand: "offen" });
    expect(konflikte).toHaveLength(2);
    expect((konflikte[0] as { target: unknown[] }).target).toHaveLength(3);
    expect(konflikte[0]).toHaveProperty("targetWhere");
    expect((konflikte[0] as { set: Record<string, unknown> }).set).toMatchObject({ gelesenAm: null, zustand: "offen", ereignisId: "e1" });
  });

  it("ohne aktive Pruefer/Admins kein Eintrag; anzahl mindestens 1", async () => {
    const leer = fakeTx([]);
    expect(await stelleImportAbschlussZu(leer.tx, { importLaufId: "lauf-1", ausloeserId: "p1", ereignisId: "e1", importiert: 0 })).toBe(0);
    expect(leer.inserts).toHaveLength(0);
    const einer = fakeTx([{ id: "p1" }]);
    await stelleImportAbschlussZu(einer.tx, { importLaufId: "lauf-1", ausloeserId: "p1", ereignisId: "e1", importiert: 0 });
    expect(einer.inserts[0]).toMatchObject({ anzahl: 1 });
  });
});
