/**
 * AP2.9 (E74): die Schreibstelle sendeMail — Probemodus protokolliert ohne
 * jeden Netzaufruf, Modus graph holt Token und sendet; das Ereignis traegt
 * nie Betreff oder Text; ein Fehlschlag hinterlaesst kein Ereignis; Logs
 * maskieren den Empfaenger (E73).
 */
import { describe, expect, it, vi } from "vitest";

const protokolle: Record<string, unknown>[] = [];
vi.mock("@/lib/protokoll", () => ({ protokolliere: async (_tx: unknown, e: Record<string, unknown>) => { protokolle.push(e); return { id: "e1" }; } }));

const { ereignisText, mailKonfigAus, maskiereEmail, sendeMail } = await import("./index");

const tx = {} as never;
const auftrag = { art: "roundup" as const, empfaenger: { id: "u1", email: "ida.ich@bhyo.de" }, betreff: "bhyo Roundup GEHEIM-BETREFF", text: "GEHEIM-TEXT Zeile 1" };
const graph = { tenantId: "t", clientId: "c", clientSecret: "s" };

describe("mailKonfigAus", () => {
  it("Standard ist protokoll; graph nur mit allen drei Secrets", () => {
    expect(mailKonfigAus({})).toEqual({ modus: "protokoll", absender: "", graph: null });
    expect(mailKonfigAus({ MAIL_MODUS: "graph", MAIL_ABSENDER: "news@bhyo.de", M365_TENANT_ID: "t", M365_CLIENT_ID: "c" }).graph).toBeNull();
    expect(mailKonfigAus({ MAIL_MODUS: "graph", MAIL_ABSENDER: "news@bhyo.de", M365_TENANT_ID: "t", M365_CLIENT_ID: "c", M365_CLIENT_SECRET: "s" })).toEqual({ modus: "graph", absender: "news@bhyo.de", graph });
  });
  it("maskiereEmail laesst nur ersten Buchstaben und Domain", () => {
    expect(maskiereEmail("eric.schmitt@bhyo.de")).toBe("e***@bhyo.de");
    expect(maskiereEmail("kaputt")).toBe("***");
  });
});

describe("sendeMail", () => {
  it("Probemodus: kein fetch, Ereignis mail_gesendet am Empfaenger ohne Betreff/Text, Log nur mit Nutzer-ID", async () => {
    protokolle.length = 0;
    const logs: string[] = [];
    const holen = vi.fn() as unknown as typeof fetch;
    const erg = await sendeMail(tx, auftrag, { modus: "protokoll", absender: "news@bhyo.de", graph: null }, holen, (z) => logs.push(z));
    expect(erg).toEqual({ ok: true, modus: "protokoll" });
    expect(holen).not.toHaveBeenCalled();
    expect(protokolle).toHaveLength(1);
    expect(protokolle[0]).toMatchObject({ art: "mail_gesendet", entitaet: "benutzer", id: "u1", benutzerId: "u1" });
    // Eric 09.10.2026: das unveraenderliche Protokoll nennt den Modus ausdruecklich.
    expect(protokolle[0]!.text).toBe("Tages-Mail protokolliert (Probemodus, nicht gesendet), modus=protokoll: roundup, Betreff 27 Zeichen, Text 19 Zeichen");
    expect(JSON.stringify(protokolle[0])).not.toMatch(/GEHEIM/);
    expect(logs.join("\n")).toMatch(/MAIL protokoll art=roundup an=u1 /);
    expect(logs.join("\n")).not.toMatch(/GEHEIM|ida\.ich/);
  });
  it("Modus graph: Token holen, senden, dann Ereignis; nichts von Secret oder Token im Log", async () => {
    protokolle.length = 0;
    const logs: string[] = [];
    const aufrufe: string[] = [];
    const holen = (async (url: string | URL | Request) => {
      aufrufe.push(String(url));
      return aufrufe.length === 1 ? new Response(JSON.stringify({ access_token: "TOKEN-xyz", expires_in: 10 }), { status: 200 }) : new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const erg = await sendeMail(tx, auftrag, { modus: "graph", absender: "news@bhyo.de", graph: { ...graph, clientSecret: "SECRET-123" } }, holen, (z) => logs.push(z));
    expect(erg).toEqual({ ok: true, modus: "graph" });
    expect(aufrufe).toHaveLength(2);
    expect(aufrufe[1]).toContain("/users/news%40bhyo.de/sendMail");
    expect(protokolle[0]).toMatchObject({ art: "mail_gesendet", text: expect.stringMatching(/^Tages-Mail gesendet, modus=graph: roundup, /) });
    expect(logs.join("\n")).not.toMatch(/SECRET-123|TOKEN-xyz|GEHEIM/);
  });
  it("Modus graph ohne Secrets: nicht_konfiguriert, kein Aufruf, kein Ereignis", async () => {
    protokolle.length = 0;
    const holen = vi.fn() as unknown as typeof fetch;
    const erg = await sendeMail(tx, auftrag, { modus: "graph", absender: "news@bhyo.de", graph: null }, holen, () => {});
    expect(erg).toEqual({ ok: false, ursache: "nicht_konfiguriert", wiederholenNach: null });
    expect(holen).not.toHaveBeenCalled();
    expect(protokolle).toHaveLength(0);
  });
  it("Versandfehler (Secret abgelaufen) → Ergebnis mit Ursache, kein Ereignis", async () => {
    protokolle.length = 0;
    const holen = (async () => new Response(JSON.stringify({ error_codes: [7000222] }), { status: 401 })) as unknown as typeof fetch;
    const erg = await sendeMail(tx, auftrag, { modus: "graph", absender: "news@bhyo.de", graph }, holen, () => {});
    expect(erg).toEqual({ ok: false, ursache: "secret_abgelaufen", wiederholenNach: null });
    expect(protokolle).toHaveLength(0);
  });
});

describe("ereignisText", () => {
  it("Probemodus und Versand sind am Text unterscheidbar; kein Betreff, kein Inhalt", () => {
    const a = { art: "roundup" as const, betreff: "GEHEIM", text: "GEHEIM-TEXT" };
    expect(ereignisText(a, "protokoll")).toBe("Tages-Mail protokolliert (Probemodus, nicht gesendet), modus=protokoll: roundup, Betreff 6 Zeichen, Text 11 Zeichen");
    expect(ereignisText(a, "graph")).toBe("Tages-Mail gesendet, modus=graph: roundup, Betreff 6 Zeichen, Text 11 Zeichen");
    expect(ereignisText({ ...a, art: "probe" }, "graph")).toMatch(/^Mail gesendet, modus=graph: probe, /);
  });
});

