/**
 * E77 R7: Die Bild-Route liefert nur an angemeldete Nutzer und nimmt den
 * R2-Key aus der Zeile, nie aus der URL.
 *   1. Ohne Zugang (401/403 der Wache): weder Datenbank noch R2 werden gelesen.
 *   2. Ungueltige ID (kein UUID), Nutzer ohne Bild, Objekt fehlt: 404, kein Body-Stream.
 *   3. Mit Bild: genau der Key aus der Zeile wird geholt; Content-Type aus R2, Cache privat, nosniff.
 */
import { describe, expect, it, vi } from "vitest";

const wache = vi.fn();
const zeile = vi.fn();
const get = vi.fn();
vi.mock("@/lib/rechte/wache", () => ({ zugangFuerRoute: () => wache() }));
vi.mock("@/lib/db", () => ({
  withDb: async (fn: (db: unknown) => unknown) =>
    fn({ select: () => ({ from: () => ({ where: () => ({ limit: async () => zeile() }) }) }) }),
  getBelegeBucket: async () => ({ get: (key: string) => get(key) }),
}));

const { GET } = await import("./route");
const ID = "00000000-0000-4000-8000-0000000000e1";
const req = new Request("http://test/api/profil/bild/" + ID);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const angemeldet = () => wache.mockResolvedValueOnce({ ok: true, zugang: { art: "erlaubt", id: "u-x", email: "x@bhyo.de", rolle: "betrachter" } });

describe("GET /api/profil/bild/[id]", () => {
  it("nicht angemeldet: Antwort der Wache, kein Lesen", async () => {
    const antwort = Response.json({ error: "Nicht authentifiziert" }, { status: 401 });
    wache.mockResolvedValueOnce({ ok: false, antwort });
    const res = await GET(req, ctx(ID));
    expect(res).toBe(antwort);
    expect(zeile).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("keine UUID: 404 ohne Datenbank", async () => {
    angemeldet();
    const res = await GET(req, ctx("../belege/x"));
    expect(res.status).toBe(404);
    expect(zeile).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("Nutzer ohne Bild: 404, R2 nicht gefragt", async () => {
    angemeldet();
    zeile.mockResolvedValueOnce([{ bildKey: null }]);
    const res = await GET(req, ctx(ID));
    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it("Objekt fehlt in R2: 404", async () => {
    angemeldet();
    zeile.mockResolvedValueOnce([{ bildKey: "profil/p/u/k.png" }]);
    get.mockResolvedValueOnce(null);
    const res = await GET(req, ctx(ID));
    expect(res.status).toBe(404);
    expect(get).toHaveBeenCalledWith("profil/p/u/k.png");
  });

  it("mit Bild: Key aus der Zeile, Typ aus R2, privat gecacht, nosniff", async () => {
    angemeldet();
    zeile.mockResolvedValueOnce([{ bildKey: "profil/p/u/k.webp" }]);
    get.mockResolvedValueOnce({ body: new Blob(["x"]).stream(), size: 1, httpMetadata: { contentType: "image/webp" } });
    const res = await GET(req, ctx(ID));
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledWith("profil/p/u/k.webp");
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe("x");
  });
});
