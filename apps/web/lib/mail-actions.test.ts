/**
 * AP2.9 Umschalten: der Testversand wird AUFGERUFEN — Rolle (Wache), Adressregel
 * (nur die hinterlegte Testadresse, nur von ihr selbst) und der Weg ueber die
 * eine Schreibstelle sendeMail. Bei Ablehnung wird nichts gesendet.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let wache: { email: string; zugang: { id: string } } | { ok: false; fehler: string } = { ok: false, fehler: "Kein Recht für diese Aktion." };
let env: Record<string, string | undefined> = {};
const gesendet: { art: string; an: string; modus: string }[] = [];
let antwort: () => { ok: true; modus: "protokoll" | "graph" } | { ok: false; ursache: string; wiederholenNach: null } = () => ({ ok: true, modus: "protokoll" });

vi.mock("@/lib/rechte/wache", () => ({ rechtFuerAction: async () => wache }));
vi.mock("@/lib/db", () => ({
  getBindings: async () => env,
  withDb: async (fn: (db: unknown) => unknown) => fn({ transaction: async (f: (tx: unknown) => unknown) => f({}) }),
}));
vi.mock("@/lib/mail", async (orig) => {
  const echt = (await orig()) as Record<string, unknown>;
  return {
    ...echt,
    sendeMail: async (_tx: unknown, a: { art: string; empfaenger: { email: string } }, k: { modus: string }) => {
      gesendet.push({ art: a.art, an: a.empfaenger.email, modus: k.modus });
      return antwort();
    },
  };
});

const { testversandAnMich } = await import("./mail-actions");

beforeEach(() => {
  gesendet.length = 0;
  antwort = () => ({ ok: true, modus: "protokoll" });
  env = { MAIL_MODUS: "protokoll", MAIL_ABSENDER: "news@bhyo.de", MAIL_TEST_EMPFAENGER: "Eric.Schmitt@bhyo.de" };
  wache = { email: "eric.schmitt@bhyo.de", zugang: { id: "u-eric" } };
});

describe("testversandAnMich", () => {
  it("ohne Recht: abgewiesen, nichts gesendet", async () => {
    wache = { ok: false, fehler: "Kein Recht für diese Aktion." };
    expect(await testversandAnMich()).toEqual({ ok: false, fehler: "Kein Recht für diese Aktion." });
    expect(gesendet).toEqual([]);
  });
  it("Admin, der nicht die Testadresse ist: abgewiesen, nichts gesendet", async () => {
    wache = { email: "zwei@bhyo.de", zugang: { id: "u2" } };
    const erg = await testversandAnMich();
    expect(erg.ok).toBe(false);
    expect(erg.fehler).toMatch(/hinterlegte Testadresse/);
    expect(gesendet).toEqual([]);
  });
  it("ohne hinterlegte Testadresse: abgewiesen (fail closed)", async () => {
    env = { MAIL_MODUS: "graph" };
    expect((await testversandAnMich()).ok).toBe(false);
    expect(gesendet).toEqual([]);
  });
  it("Testadresse selbst: Probe-Mail an die eigene Adresse ueber sendeMail, Modus im Ergebnis", async () => {
    expect(await testversandAnMich()).toEqual({ ok: true, modus: "protokoll" });
    expect(gesendet).toEqual([{ art: "probe", an: "eric.schmitt@bhyo.de", modus: "protokoll" }]);
  });
  it("Fehlschlag des Adapters wird als Ursache gemeldet", async () => {
    antwort = () => ({ ok: false, ursache: "secret_abgelaufen", wiederholenNach: null });
    expect(await testversandAnMich()).toEqual({ ok: false, fehler: "Versand fehlgeschlagen: secret_abgelaufen" });
  });
});
