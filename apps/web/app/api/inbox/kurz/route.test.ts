/**
 * E77 R5 (Bedingung Eric 13.10.2026): Die GET-Route des Pop-ups prueft die
 * Anmeldung und liefert nur Eintraege des angemeldeten Nutzers. Ohne Zugang
 * kommt die Antwort der Wache zurueck (401/403) und nichts wird gelesen; mit
 * Zugang kommt die Nutzer-ID AUS DER WACHE in die Abfrage — die Anfrage
 * selbst traegt keinen Parameter, der sie beeinflussen koennte. Dass die
 * Abfrage auf empfaenger_id = Nutzer-ID filtert, belegt
 * lib/inbox/server.lesen.test.ts an der echten ladeEintraege.
 */
import { describe, expect, it, vi } from "vitest";

const wache = vi.fn();
const ladeEintraege = vi.fn();
vi.mock("@/lib/rechte/wache", () => ({ zugangFuerRoute: () => wache() }));
vi.mock("@/lib/db", () => ({ withDb: async (fn: (db: unknown) => unknown) => fn({ db: "attrappe" }) }));
vi.mock("@/lib/inbox/server", () => ({ ladeEintraege: (...a: unknown[]) => ladeEintraege(...a) }));

const { GET } = await import("./route");

describe("GET /api/inbox/kurz", () => {
  it("nicht angemeldet: Antwort der Wache (401), kein Lesen", async () => {
    const antwort = Response.json({ error: "Nicht authentifiziert" }, { status: 401 });
    wache.mockResolvedValueOnce({ ok: false, antwort });
    const res = await GET();
    expect(res).toBe(antwort);
    expect(res.status).toBe(401);
    expect(ladeEintraege).not.toHaveBeenCalled();
  });

  it("unbekannt/deaktiviert (403 der Wache): ebenfalls kein Lesen", async () => {
    const antwort = Response.json({ error: "Kein Zugang eingerichtet" }, { status: 403 });
    wache.mockResolvedValueOnce({ ok: false, antwort });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(ladeEintraege).not.toHaveBeenCalled();
  });

  it("angemeldet: liest mit der Nutzer-ID aus der Wache, nur offene, hoechstens fuenf — und gibt genau diese Zeilen zurueck", async () => {
    wache.mockResolvedValueOnce({ ok: true, zugang: { art: "erlaubt", id: "u-eric", email: "eric@bhyo.de", rolle: "admin" } });
    ladeEintraege.mockResolvedValueOnce([{ id: "e1", aktualisiertAm: "2026-10-13T08:00:00.000Z", text: "x" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(ladeEintraege).toHaveBeenCalledTimes(1);
    expect(ladeEintraege).toHaveBeenCalledWith({ db: "attrappe" }, "u-eric", "offen", { limit: 5 });
    const body = (await res.json()) as { zeilen: { id: string; zeit: string }[] };
    expect(body.zeilen.map((z) => z.id)).toEqual(["e1"]);
    expect(typeof body.zeilen[0]!.zeit).toBe("string");
  });
});
