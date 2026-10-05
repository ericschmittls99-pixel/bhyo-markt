/**
 * AP2.4 PR c (E63, D5): Weitergeben — nur der Empfaenger des Eintrags, ab
 * bearbeiter, nie an sich selbst, nur an aktive Nutzer mit Rolle >= bearbeiter,
 * Aufgabentext nicht leer und hoechstens 500 Zeichen (serverseitig; die DB
 * hat denselben CHECK). Die Action wird echt aufgerufen, Infrastruktur ist
 * gemockt. Vor der Implementierung ist „leerer Text" rot (einmal gezeigt).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ICH = { id: "00000000-0000-4000-8000-000000000001", email: "ich@bhyo.de", rolle: "bearbeiter" as const, name: "Ich", aktiv: true };
const ANDERE = "00000000-0000-4000-8000-000000000002";
const DRITTE = "00000000-0000-4000-8000-000000000003";
const STROM = "00000000-0000-4000-8000-0000000000c1";

let eintrag: Record<string, unknown> | null = null;
let empfaenger: Record<string, unknown> | null = null;
let updates: Record<string, unknown>[] = [];
const protokolliere = vi.fn(async (_tx: unknown, _e: unknown) => ({ id: "e-neu" }));
vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => ICH.email,
  withDb: async (fn: (db: unknown) => unknown) => {
    const tx = {
      // Erstes select: der Eintrag (FOR UPDATE); zweites: der Empfaenger (limit).
      select: () => ({
        from: () => ({
          where: () => ({
            for: async () => (eintrag ? [eintrag] : []),
            limit: async () => (empfaenger ? [empfaenger] : []),
          }),
        }),
      }),
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

const { inboxWeitergeben } = await import("./actions");

beforeEach(() => {
  eintrag = { id: "e1", empfaengerId: ICH.id, ausloeserId: null, typ: "verifikation_abgelaufen", zustand: "offen", gelesenAm: null, biomassestromId: STROM, outputBedarfId: null };
  empfaenger = { id: ANDERE, name: "Bernd Bearbeiter", email: "bernd@bhyo.de", rolle: "bearbeiter", aktiv: true };
  updates = [];
  protokolliere.mockClear();
});

describe("inboxWeitergeben (E63, D5)", () => {
  it("leerer Aufgabentext wird serverseitig abgewiesen — nichts geschrieben, kein Ereignis", async () => {
    for (const text of ["", "   ", "\n\t"]) {
      const erg = await inboxWeitergeben("e1", ANDERE, text);
      expect(erg).toEqual({ ok: false, fehler: "Der Aufgabentext darf nicht leer sein." });
    }
    expect(updates).toEqual([]);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("mehr als 500 Zeichen werden abgewiesen", async () => {
    const erg = await inboxWeitergeben("e1", ANDERE, "x".repeat(501));
    expect(erg).toEqual({ ok: false, fehler: "Der Aufgabentext darf höchstens 500 Zeichen haben." });
    expect(updates).toEqual([]);
  });
  it("an sich selbst ist nicht erlaubt", async () => {
    const erg = await inboxWeitergeben("e1", ICH.id, "Bitte aktualisieren");
    expect(erg).toEqual({ ok: false, fehler: "Weitergeben an dich selbst ist nicht möglich." });
    expect(updates).toEqual([]);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("Empfaenger muss aktiv sein und mindestens bearbeiter — Betrachter, Deaktivierte, Unbekannte abgewiesen", async () => {
    for (const e of [{ ...empfaenger!, rolle: "betrachter" }, { ...empfaenger!, aktiv: false }, null]) {
      empfaenger = e;
      const erg = await inboxWeitergeben("e1", ANDERE, "Bitte aktualisieren");
      expect(erg).toEqual({ ok: false, fehler: "Diese Person kann keine Aufgabe übernehmen (nicht aktiv oder nur Betrachter)." });
    }
    expect(updates).toEqual([]);
  });
  it("nur pruefauftrag und die beiden Ablauf-Hinweise lassen sich weitergeben; nur offene; nur eigene", async () => {
    eintrag = { ...eintrag!, typ: "aenderung_eintrag" };
    expect((await inboxWeitergeben("e1", ANDERE, "Bitte aktualisieren")).fehler).toBe("Dieser Eintrag lässt sich nicht weitergeben.");
    eintrag = { ...eintrag!, typ: "pruefauftrag", zustand: "erledigt" };
    expect((await inboxWeitergeben("e1", ANDERE, "Bitte aktualisieren")).fehler).toBe("Der Eintrag ist nicht mehr offen.");
    eintrag = { ...eintrag!, zustand: "offen", empfaengerId: DRITTE };
    expect((await inboxWeitergeben("e1", ANDERE, "Bitte aktualisieren")).fehler).toBe("Dieser Eintrag gehört einer anderen Person.");
    expect(updates).toEqual([]);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("E65: der eigene Eintrag bleibt OFFEN (nur gelesen), Ereignis weitergegeben mit Objektbezug Strom, betroffener Person und Aufgabe", async () => {
    const erg = await inboxWeitergeben("e1", ANDERE, "  Bitte aktualisieren  ");
    expect(erg).toEqual({ ok: true });
    // Kein Zustandswechsel: der Absender-Eintrag bleibt offen, bis die Sache selbst erledigt ist.
    expect(updates.filter((u) => "zustand" in u)).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ gelesenAm: expect.any(Date) });
    expect(protokolliere).toHaveBeenCalledTimes(1);
    expect(protokolliere.mock.calls[0]![1]).toMatchObject({
      art: "weitergegeben",
      entitaet: "biomassestrom",
      id: STROM,
      benutzerId: ICH.id,
      betrifftId: ANDERE,
      aufgabe: "Bitte aktualisieren",
      text: "Weitergegeben an Bernd Bearbeiter: Bitte aktualisieren",
    });
  });
});
