/**
 * Inbox-Aktionen: nur der Empfaenger. Die Aktionen werden echt aufgerufen,
 * Datenbank und Wache sind Attrappen — fremde Eintraege werden serverseitig
 * abgewiesen, ohne zu schreiben.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ICH = { id: "00000000-0000-4000-8000-000000000001", email: "ich@bhyo.de", rolle: "betrachter" as const, name: "Ich", aktiv: true };
const ANDERE = "00000000-0000-4000-8000-000000000002";

/** Die Zeile, die die Attrappe beim FOR-UPDATE-Lesen liefert. */
let eintrag: { id: string; empfaengerId: string; ausloeserId: string; typ: string; zustand: string; gelesenAm: Date | null; biomassestromId: string | null; outputBedarfId: string | null } | null = null;
let updates: Record<string, unknown>[] = [];
const protokolliere = vi.fn(async (_tx: unknown, _e: unknown) => ({ id: "e-neu" }));
vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));

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

const { inboxGelesen, inboxUngelesen, inboxErledigen, inboxVerwerfen, inboxAlleErledigen, inboxAblehnen } = await import("./actions");
const STROM = "00000000-0000-4000-8000-0000000000c1";

beforeEach(() => {
  eintrag = { id: "e1", empfaengerId: ICH.id, ausloeserId: ANDERE, typ: "aenderung_eintrag", zustand: "offen", gelesenAm: null, biomassestromId: STROM, outputBedarfId: null };
  updates = [];
  protokolliere.mockClear();
});

describe("Inbox-Aktionen: nur der Empfaenger", () => {
  it("fremde Eintraege werden bei jeder Einzelaktion abgewiesen, ohne zu schreiben", async () => {
    eintrag = { ...eintrag!, empfaengerId: ANDERE };
    for (const lauf of [() => inboxGelesen("e1"), () => inboxUngelesen("e1"), () => inboxErledigen("e1"), () => inboxVerwerfen("e1"), () => inboxAblehnen("e1")]) {
      const erg = await lauf();
      expect(erg.ok).toBe(false);
      expect(erg.fehler).toBe("Dieser Eintrag gehört einer anderen Person.");
    }
    expect(updates).toEqual([]);
    expect(protokolliere).not.toHaveBeenCalled();
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
  it("E65: Verwerfen der weitergegebenen Aufgabe aendert nur den eigenen Eintrag (FOR UPDATE per id) — der Absender-Eintrag bleibt offen, kein Ereignis", async () => {
    eintrag = { ...eintrag!, typ: "aufgabe" };
    const erg = await inboxVerwerfen("e1");
    expect(erg).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ zustand: "verworfen" });
    expect(protokolliere).not.toHaveBeenCalled();
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

describe("PR c: Ablehnen", () => {
  it("nur eine offene Zugriffsanfrage — protokolliert zugriff_abgelehnt am Strom, betroffen ist der Anfragende", async () => {
    eintrag = { ...eintrag!, typ: "zugriffsanfrage" };
    expect(await inboxAblehnen("e1")).toEqual({ ok: true });
    expect(protokolliere).toHaveBeenCalledTimes(1);
    expect(protokolliere.mock.calls[0]![1]).toMatchObject({
      art: "zugriff_abgelehnt",
      entitaet: "biomassestrom",
      id: STROM,
      benutzerId: ICH.id,
      betrifftId: ANDERE,
    });
    // Das Abraeumen und die Antwort erledigt die Zustellung (lib/inbox/zustellung.ts), nicht die Aktion.
    expect(updates).toEqual([]);
  });
  it("kein Hinweis-Eintrag und keine erledigte Anfrage lassen sich ablehnen", async () => {
    expect((await inboxAblehnen("e1")).fehler).toBe("Nur eine Zugriffsanfrage lässt sich ablehnen.");
    eintrag = { ...eintrag!, typ: "zugriffsanfrage", zustand: "erledigt" };
    expect((await inboxAblehnen("e1")).fehler).toBe("Die Anfrage ist nicht mehr offen.");
    expect(protokolliere).not.toHaveBeenCalled();
  });
});
