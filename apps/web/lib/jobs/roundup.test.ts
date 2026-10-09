/**
 * AP2.9 (E76): Roundup — Werktag Berlin, „nur bei Neuem", Text nur mit
 * Zaehlern und Links, Ablauf gegen eine Zugriffs-Attrappe: Idempotenz je
 * Stichtag, Markierung nur bei Erfolg, Drosselung einmal wiederholt, Log je
 * Nutzer nur mit ID. sendeMail ist gemockt (eigene Tests in lib/mail).
 */
import { describe, expect, it, vi } from "vitest";

const gesendet: { id: string; betreff: string; text: string }[] = [];
let antworten: (() => import("@/lib/mail").MailErgebnis)[] = [];
vi.mock("@/lib/mail", () => ({
  sendeMail: async (_tx: unknown, a: { empfaenger: { id: string }; betreff: string; text: string }) => {
    gesendet.push({ id: a.empfaenger.id, betreff: a.betreff, text: a.text });
    const f = antworten.shift();
    return f ? f() : { ok: true, modus: "protokoll" };
  },
}));

import type { RoundupZugriff } from "./roundup";

const { fuehreRoundupAus, istWerktagBerlin, roundupText, wuerdeSenden } = await import("./roundup");

const konfig = { modus: "protokoll" as const, absender: "news@bhyo.de", graph: null };
// Donnerstag 09.10.2026 07:07 Berlin = 05:07 UTC (Sommerzeit)
const DO = new Date("2026-10-09T05:07:00Z");

describe("istWerktagBerlin", () => {
  it("Mo–Fr ja, Sa/So nein — am Berliner Kalendertag gemessen", () => {
    expect(istWerktagBerlin(DO)).toBe(true);
    expect(istWerktagBerlin(new Date("2026-10-10T05:07:00Z"))).toBe(false); // Samstag
    expect(istWerktagBerlin(new Date("2026-10-11T05:07:00Z"))).toBe(false); // Sonntag
    expect(istWerktagBerlin(new Date("2026-10-12T05:07:00Z"))).toBe(true); // Montag
    expect(istWerktagBerlin(new Date("2026-10-09T22:30:00Z"))).toBe(false); // Fr 22:30 UTC = Sa 00:30 Berlin
    expect(istWerktagBerlin(new Date("2026-10-11T22:30:00Z"))).toBe(true); // So 22:30 UTC = Mo 00:30 Berlin
  });
});

describe("wuerdeSenden / roundupText", () => {
  const z = [
    { typ: "kommentar", offen: 2, neu: 1 },
    { typ: "aufgabe", offen: 1, neu: 1 },
    { typ: "verifikation_laeuft_ab", offen: 4, neu: 0 },
  ];
  it("nur bei Neuem: Altbestand allein loest nichts aus", () => {
    expect(wuerdeSenden(z)).toBe(true);
    expect(wuerdeSenden([{ typ: "kommentar", offen: 5, neu: 0 }])).toBe(false);
    expect(wuerdeSenden([])).toBe(false);
  });
  it("Text: Zaehler je Typ in fester Reihenfolge, ein Link auf /inbox, Fusszeile zum Abmelden, keine Inhalte", () => {
    const { betreff, text } = roundupText(z, "https://bhyo-markt.bhyo.workers.dev");
    expect(betreff).toBe("bhyo: 2 neue Hinweise in deiner Inbox");
    const zeilen = text.split("\n");
    expect(zeilen[0]).toBe("Seit deinem letzten Roundup sind 2 neue Hinweise dazugekommen, insgesamt 7 offen.");
    expect(zeilen.filter((l) => l.startsWith("- "))).toEqual([
      "- Aufgaben an dich: 1 offen, davon 1 neu",
      "- Neue Kommentare: 2 offen, davon 1 neu",
      "- Verifikationen, die ablaufen: 4 offen",
    ]);
    expect(text).toContain("Zur Inbox: https://bhyo-markt.bhyo.workers.dev/inbox");
    expect(text).toContain("Abmelden: https://bhyo-markt.bhyo.workers.dev/einstellungen#roundup");
    expect(roundupText([{ typ: "kommentar", offen: 1, neu: 1 }], "x").betreff).toBe("bhyo: 1 neuer Hinweis in deiner Inbox");
  });
});

function attrappe(empfaenger: { id: string; email: string; seit: Date | null }[], zaehler: Record<string, { typ: string; offen: number; neu: number }[]>) {
  const laeufe: string[] = [];
  const beendet: unknown[] = [];
  const markiert: string[] = [];
  const zugriff: RoundupZugriff = {
    async beginneLauf(stichtag) {
      if (laeufe.includes(stichtag)) return null;
      laeufe.push(stichtag);
      return `lauf-${stichtag}`;
    },
    async beendeLauf(_id, e) {
      beendet.push(e);
    },
    async ladeEmpfaenger() {
      return empfaenger;
    },
    async zaehle(id) {
      return zaehler[id] ?? [];
    },
    async sendeUndMarkiere(id, _jetzt, senden) {
      const erg = await senden({} as never);
      if (erg.ok) markiert.push(id);
      return erg;
    },
  };
  return { zugriff, laeufe, beendet, markiert };
}

describe("fuehreRoundupAus", () => {
  it("Wochenende: kein Lauf, keine Zeile", async () => {
    const a = attrappe([{ id: "u1", email: "a@bhyo.de", seit: null }], { u1: [{ typ: "kommentar", offen: 1, neu: 1 }] });
    expect(await fuehreRoundupAus(a.zugriff, new Date("2026-10-10T05:07:00Z"), konfig, "https://x")).toEqual({ lauf: "wochenende", stichtag: "2026-10-10" });
    expect(a.laeufe).toEqual([]);
  });
  it("Werktag: sendet nur bei Neuem, markiert nur Gesendete, loggt je Nutzer nur die ID; zweiter Lauf desselben Tags uebersprungen", async () => {
    gesendet.length = 0;
    antworten = [];
    const logs: string[] = [];
    const a = attrappe(
      [
        { id: "u1", email: "ida.ich@bhyo.de", seit: null },
        { id: "u2", email: "otto@bhyo.de", seit: new Date("2026-10-08T05:07:00Z") },
        { id: "u3", email: "ohne@bhyo.de", seit: null },
      ],
      { u1: [{ typ: "kommentar", offen: 2, neu: 2 }], u2: [{ typ: "aufgabe", offen: 3, neu: 0 }] },
    );
    const erg = await fuehreRoundupAus(a.zugriff, DO, konfig, "https://x", undefined as never, (z) => logs.push(z));
    expect(erg).toEqual({ lauf: "ok", stichtag: "2026-10-09", empfaenger: 3, wuerdeSenden: 1, gesendet: 1, fehler: 0, ursachen: {} });
    expect(gesendet.map((g) => g.id)).toEqual(["u1"]);
    expect(a.markiert).toEqual(["u1"]);
    expect(logs).toEqual([
      'ROUNDUP nutzer=u1 wuerde_senden=ja neu=2 offen=2 typen={"kommentar":{"offen":2,"neu":2}}',
      'ROUNDUP nutzer=u2 wuerde_senden=nein neu=0 offen=3 typen={"aufgabe":{"offen":3,"neu":0}}',
      "ROUNDUP nutzer=u3 wuerde_senden=nein neu=0 offen=0 typen={}",
    ]);
    expect(logs.join("\n")).not.toMatch(/@bhyo\.de/);
    expect(a.beendet[0]).toEqual({ ergebnis: "ok", anzahl: 1, schritte: { empfaenger: 3, wuerde_senden: 1, gesendet: 1, fehler: 0 } });
    expect(await fuehreRoundupAus(a.zugriff, DO, konfig, "https://x")).toEqual({ lauf: "uebersprungen", stichtag: "2026-10-09" });
  });
  it("Fehler je Nutzer brechen nicht ab; Drosselung wird einmal wiederholt; Ursachen gezaehlt; keine Markierung bei Fehlschlag", async () => {
    gesendet.length = 0;
    antworten = [
      () => ({ ok: false, ursache: "secret_abgelaufen", wiederholenNach: null }),
      () => ({ ok: false, ursache: "gedrosselt", wiederholenNach: 0 }),
      () => ({ ok: true, modus: "graph" }),
    ];
    const a = attrappe(
      [
        { id: "u1", email: "a@bhyo.de", seit: null },
        { id: "u2", email: "b@bhyo.de", seit: null },
      ],
      { u1: [{ typ: "kommentar", offen: 1, neu: 1 }], u2: [{ typ: "kommentar", offen: 1, neu: 1 }] },
    );
    const erg = await fuehreRoundupAus(a.zugriff, DO, { ...konfig, modus: "graph" }, "https://x", undefined as never, () => {});
    expect(erg).toMatchObject({ lauf: "ok", wuerdeSenden: 2, gesendet: 1, fehler: 1, ursachen: { secret_abgelaufen: 1 } });
    expect(gesendet.map((g) => g.id)).toEqual(["u1", "u2", "u2"]);
    expect(a.markiert).toEqual(["u2"]);
    expect(a.beendet[0]).toMatchObject({ schritte: { wuerde_senden: 2, gesendet: 1, fehler: 1, ursache_secret_abgelaufen: 1 } });
  });
});
