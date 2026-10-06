/**
 * Geocode-Diagnose (Eric 06.10.2026): jeder Fehlschlag traegt Ursache, Status,
 * Dauer und gekuerzte Antwort — ins Log (ohne Nutzereingaben im Klartext) und
 * in die Ausnahme fuer die Oberflaeche.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { PHOTON_USER_AGENT, PhotonNichtErreichbar, photonMeldung, photonSuche, ursacheAusFehler } from "./photon-server";

const logs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  logs.length = 0;
});
function fangeLog() {
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
}

describe("photonSuche — Diagnose", () => {
  it("HTTP-Fehler: Ursache http, Status, gekuerzte Antwort; Log ohne Suchtext, mit User-Agent", async () => {
    fangeLog();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Forbidden: fair use</html>", { status: 403 })));
    const e = await photonSuche("Dorfstraße 3, 67346 Speyer").catch((x) => x);
    expect(e).toBeInstanceOf(PhotonNichtErreichbar);
    expect(e.diagnose).toMatchObject({ ursache: "http", status: 403, antwort: "<html>Forbidden: fair use</html>" });
    expect(e.message).toMatch(/Fehler 403/);
    expect(logs[0]).toMatch(/^GEOCODE_FEHLER /);
    expect(logs[0]).toContain('"kennung":"suche laenge=26"');
    expect(logs[0]).toContain(PHOTON_USER_AGENT);
    expect(logs[0]).not.toMatch(/Dorfstraße|Speyer/);
    expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1]).toMatchObject({ headers: { "User-Agent": PHOTON_USER_AGENT } });
  });

  it("Zeitlimit und Netzfehler werden unterschieden", async () => {
    fangeLog();
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw timeout; }));
    const e = await photonSuche("Speyer").catch((x) => x);
    expect(e.diagnose).toMatchObject({ ursache: "zeitlimit", status: null });
    expect(e.message).toMatch(/nach 5 s nicht geantwortet/);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed: getaddrinfo ENOTFOUND"); }));
    const n = await photonSuche("Speyer").catch((x) => x);
    expect(n.diagnose).toMatchObject({ ursache: "netz", status: null, antwort: "TypeError: fetch failed: getaddrinfo ENOTFOUND" });
    expect(n.message).toMatch(/Netz\/DNS/);
    expect(ursacheAusFehler({})).toBe("netz");
  });

  it("unlesbare Antwort ist Ursache antwort; Erfolg liefert gemappte Adressen", async () => {
    fangeLog();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    const e = await photonSuche("Speyer").catch((x) => x);
    expect(e.diagnose.ursache).toBe("antwort");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features: [{ geometry: { coordinates: [8.43, 49.32] }, properties: { countrycode: "DE", osm_key: "place", osm_value: "city", name: "Speyer", postcode: "67346" } }] })));
    const a = await photonSuche("Speyer");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ art: "ort", ort: "Speyer", plz: "67346" });
    expect(logs).toHaveLength(1);
  });

  it("photonMeldung nennt jede Ursache in Klartext", () => {
    expect(photonMeldung({ ursache: "zeitlimit", status: null, dauerMs: 5001, antwort: "" })).toMatch(/5 s/);
    expect(photonMeldung({ ursache: "http", status: 429, dauerMs: 10, antwort: "" })).toMatch(/429/);
  });
});
