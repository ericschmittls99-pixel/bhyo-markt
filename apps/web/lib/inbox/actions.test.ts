/**
 * Inbox-Aktionen: nur der Empfaenger. Die Aktionen werden echt aufgerufen,
 * Datenbank und Wache sind Attrappen — fremde Eintraege werden serverseitig
 * abgewiesen, ohne zu schreiben.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ICH = { id: "00000000-0000-4000-8000-000000000001", email: "ich@bhyo.de", rolle: "betrachter" as const, name: "Ich", aktiv: true };
const ANDERE = "00000000-0000-4000-8000-000000000002";

/** Die Zeile, die die Attrappe beim FOR-UPDATE-Lesen liefert. */
let eintrag: { id: string; empfaengerId: string; typ: string; zustand: string; gelesenAm: Date | null } | null = null;
let updates: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => ICH.email,
  withDb: async (fn: (db: unknown) => unknown) => {
    const tx = {
      select: () => ({ from: () => ({ where: () => ({ for: async () => (eintrag ? [eintrag] : []) }) }) }),
      update: () => ({
        set: (werte: Record<string, unknown>) => ({
          where: () => {
            updates.push(werte);
            return Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: "x" }] });
          },
        }),
      }),
    };
    return fn({ transaction: async (f: (t: unknown) => unknown) => f(tx) });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rechte/wache", async (orig) => ({
  ...(await orig<typeof import("@/lib/rechte/wache")>()),
  rechtFuerAction: async () => ({ email: ICH.email, zugang: { art: "erlaubt", ...ICH } }),
}));

const { inboxGelesen, inboxUngelesen, inboxErledigen, inboxVerwerfen, inboxAlleErledigen } = await import("./actions");

beforeEach(() => {
  eintrag = { id: "e1", empfaengerId: ICH.id, typ: "aenderung_eintrag", zustand: "offen", gelesenAm: null };
  updates = [];
});

describe("Inbox-Aktionen: nur der Empfaenger", () => {
  it("fremde Eintraege werden bei jeder Einzelaktion abgewiesen, ohne zu schreiben", async () => {
    eintrag = { ...eintrag!, empfaengerId: ANDERE };
    for (const lauf of [() => inboxGelesen("e1"), () => inboxUngelesen("e1"), () => inboxErledigen("e1"), () => inboxVerwerfen("e1")]) {
      const erg = await lauf();
      expect(erg.ok).toBe(false);
      expect(erg.fehler).toBe("Dieser Eintrag gehört einer anderen Person.");
    }
    expect(updates).toEqual([]);
  });
  it("ein unbekannter Eintrag wird wie ein fremder behandelt", async () => {
    eintrag = null;
    expect((await inboxErledigen("gibt-es-nicht")).ok).toBe(false);
    expect(updates).toEqual([]);
  });
  it("eigene Eintraege: gelesen, ungelesen, erledigt, verworfen", async () => {
    expect(await inboxGelesen("e1")).toEqual({ ok: true });
    expect(updates[0]!.gelesenAm).toBeInstanceOf(Date);
    expect(await inboxUngelesen("e1")).toEqual({ ok: true });
    expect(updates[1]!.gelesenAm).toBeNull();
    expect(await inboxErledigen("e1")).toEqual({ ok: true });
    expect(updates[2]).toMatchObject({ zustand: "erledigt" });
    expect(await inboxVerwerfen("e1")).toEqual({ ok: true });
    expect(updates[3]).toMatchObject({ zustand: "verworfen" });
  });
  it("Oeffnen = gelesen ist idempotent: ein bereits gelesener Eintrag wird nicht erneut geschrieben", async () => {
    eintrag = { ...eintrag!, gelesenAm: new Date() };
    expect(await inboxGelesen("e1")).toEqual({ ok: true });
    expect(updates).toEqual([]);
  });
  it("erledigen/verwerfen nur aus offen", async () => {
    eintrag = { ...eintrag!, zustand: "erledigt" };
    const erg = await inboxVerwerfen("e1");
    expect(erg.ok).toBe(false);
    expect(erg.fehler).toBe("Der Eintrag ist nicht mehr offen.");
    expect(updates).toEqual([]);
  });
  it("Alle erledigt wirkt per WHERE auf eigene offene Hinweise und meldet die Anzahl", async () => {
    const erg = await inboxAlleErledigen();
    expect(erg).toEqual({ ok: true, anzahl: 1 });
    expect(updates[0]).toMatchObject({ zustand: "erledigt" });
  });
});
