/**
 * PR c: strom.zugriff_anfragen — Wache am Eingang, Objektstufe in der
 * Transaktion, Notiz maximal 500 Zeichen, Ereignis zugriff_angefragt mit der
 * Notiz als Text (die Zustellung macht daraus den Inbox-Eintrag).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const BERND = { id: "00000000-0000-4000-8000-0000000000b1", email: "bernd@bhyo.de", rolle: "bearbeiter" as const, name: "Bernd", aktiv: true };
let sperrpruefungen = 0;
let sperreWirft = false;
const protokolliere = vi.fn(async (_tx: unknown, _e: unknown) => ({ id: "e-neu" }));
vi.mock("@/lib/protokoll", async (orig) => ({ ...(await orig<typeof import("@/lib/protokoll")>()), protokolliere }));
vi.mock("@/lib/db", () => ({
  currentUserEmail: async () => BERND.email,
  withDb: async (fn: (db: unknown) => unknown) => fn({ transaction: async (f: (t: unknown) => unknown) => f({}) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/rechte/wache", async (orig) => ({
  ...(await orig<typeof import("@/lib/rechte/wache")>()),
  rechtFuerAction: async () => ({ email: BERND.email, zugang: { art: "erlaubt", ...BERND } }),
}));
vi.mock("@/lib/rechte/sperre-server", async (orig) => {
  const echt = await orig<typeof import("@/lib/rechte/sperre-server")>();
  return {
    ...echt,
    pruefeStromSperre: async () => {
      sperrpruefungen += 1;
      if (sperreWirft) throw new echt.Gesperrt({ id: "x", name: "Petra Prüfer", email: "petra@bhyo.de" }, new Date(), "Für diese Aktion fehlt das Recht.");
      return { gesperrtVon: "x", gesperrtAm: new Date(), zugewiesene: [], inhaber: null };
    },
  };
});

const { zugriffAnfragen, NOTIZ_MAX } = await import("./sperre-actions");

beforeEach(() => {
  sperrpruefungen = 0;
  sperreWirft = false;
  protokolliere.mockClear();
});

describe("zugriffAnfragen", () => {
  it("prueft die Objektstufe in der Transaktion und protokolliert zugriff_angefragt mit der Notiz", async () => {
    expect(await zugriffAnfragen("biomasse", "s1", "  Bitte freigeben ")).toEqual({ ok: true });
    expect(sperrpruefungen).toBe(1);
    expect(protokolliere.mock.calls[0]![1]).toMatchObject({ art: "zugriff_angefragt", entitaet: "biomassestrom", id: "s1", benutzerId: BERND.id, text: "Bitte freigeben" });
  });
  it("ohne Notiz gilt der Standardtext (kein leerer Text)", async () => {
    expect(await zugriffAnfragen("output", "s2", "")).toEqual({ ok: true });
    expect((protokolliere.mock.calls[0]![1] as { text?: string }).text).toBeUndefined();
  });
  it("Notiz laenger als 500 Zeichen wird vor jeder Wirkung abgewiesen", async () => {
    const erg = await zugriffAnfragen("biomasse", "s1", "x".repeat(NOTIZ_MAX + 1));
    expect(erg.ok).toBe(false);
    expect(sperrpruefungen).toBe(0);
    expect(protokolliere).not.toHaveBeenCalled();
  });
  it("Objektregel greift: Inhaber, Zugewiesene oder ungesperrt => abgewiesen, kein Ereignis", async () => {
    sperreWirft = true;
    const erg = await zugriffAnfragen("biomasse", "s1");
    expect(erg.ok).toBe(false);
    expect(protokolliere).not.toHaveBeenCalled();
  });
});
