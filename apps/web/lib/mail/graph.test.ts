/**
 * AP2.9 (E74): Graph-Adapter gegen eine fetch-Attrappe — Form der Token-
 * und sendMail-Anfragen, 202 als Erfolg, Ursachen-Codes fuer Secret-Ablauf,
 * Zugriff, Postfach und Drosselung. E73: kein Secret, kein Token in
 * Fehlertexten.
 */
import { describe, expect, it } from "vitest";

import { GRAPH_SCOPE, GraphFehler, holeGraphToken, sendMailKoerper, sendMailUrl, sendeGraphMail, tokenUrl, tokenUrsache } from "./graph";

const konfig = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "GEHEIM-abc" };
type Aufruf = { url: string; init: RequestInit };

function attrappe(antworten: ((a: Aufruf) => Response)[]) {
  const aufrufe: Aufruf[] = [];
  const holen = (async (url: string | URL | Request, init?: RequestInit) => {
    const a = { url: String(url), init: init ?? {} };
    aufrufe.push(a);
    const f = antworten.shift();
    if (!f) throw new Error("unerwarteter Aufruf");
    return f(a);
  }) as unknown as typeof fetch;
  return { holen, aufrufe };
}
const json = (status: number, body: unknown, headers?: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("holeGraphToken", () => {
  it("client_credentials mit .default-Scope gegen den Tenant-Endpunkt; liefert Token und Ablauf", async () => {
    const { holen, aufrufe } = attrappe([() => json(200, { access_token: "tok-1", expires_in: 3599 })]);
    const t = await holeGraphToken(konfig, holen);
    expect(t).toEqual({ token: "tok-1", laeuftAbInSekunden: 3599 });
    expect(aufrufe[0]!.url).toBe(tokenUrl("tenant-1"));
    const body = aufrufe[0]!.init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("scope")).toBe(GRAPH_SCOPE);
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("GEHEIM-abc");
  });
  it("abgelaufenes Secret (AADSTS7000222) wird als secret_abgelaufen gemeldet — ohne Secret im Fehlertext", async () => {
    const { holen } = attrappe([() => json(401, { error: "invalid_client", error_codes: [7000222] })]);
    const e = await holeGraphToken(konfig, holen).catch((x) => x);
    expect(e).toBeInstanceOf(GraphFehler);
    expect((e as GraphFehler).ursache).toBe("secret_abgelaufen");
    expect(String((e as Error).message)).not.toContain("GEHEIM");
  });
  it("Ursachen-Abbildung: ungueltiges Secret, unbekannte App, Netz, sonst", () => {
    expect(tokenUrsache(401, [7000215])).toBe("secret_ungueltig");
    expect(tokenUrsache(400, [700016])).toBe("app_unbekannt");
    expect(tokenUrsache(0, [])).toBe("netz");
    expect(tokenUrsache(500, [])).toBe("token_sonst");
  });
  it("Netzfehler → netz", async () => {
    const holen = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(holeGraphToken(konfig, holen)).rejects.toMatchObject({ ursache: "netz" });
  });
});

describe("sendeGraphMail", () => {
  const nachricht = { empfaenger: "ida@bhyo.de", betreff: "Roundup", text: "Hallo" };
  it("POST users/<absender>/sendMail mit Bearer, Text-Body und saveToSentItems=false; 202 ist Erfolg", async () => {
    const { holen, aufrufe } = attrappe([() => new Response(null, { status: 202 })]);
    await expect(sendeGraphMail("tok-1", "news@bhyo.de", nachricht, holen)).resolves.toBeUndefined();
    expect(aufrufe[0]!.url).toBe(sendMailUrl("news@bhyo.de"));
    expect((aufrufe[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    expect(JSON.parse(aufrufe[0]!.init.body as string)).toEqual(sendMailKoerper(nachricht));
    expect(sendMailKoerper(nachricht).saveToSentItems).toBe(false);
    expect(sendMailKoerper(nachricht).message.toRecipients).toEqual([{ emailAddress: { address: "ida@bhyo.de" } }]);
  });
  it("403 → zugriff_verweigert (Access-Policy), 404 → postfach_unbekannt, 429 → gedrosselt mit Retry-After", async () => {
    const f = (r: Response): Promise<GraphFehler> => sendeGraphMail("t", "news@bhyo.de", nachricht, attrappe([() => r]).holen).then(() => { throw new Error("kein Fehler"); }, (x) => x as GraphFehler);
    expect((await f(json(403, { error: { code: "ErrorAccessDenied" } }))).ursache).toBe("zugriff_verweigert");
    expect((await f(json(404, { error: { code: "ErrorInvalidUser" } }))).ursache).toBe("postfach_unbekannt");
    const g = await f(json(429, {}, { "Retry-After": "30" }));
    expect(g.ursache).toBe("gedrosselt");
    expect(g.wiederholenNach).toBe(30);
  });
});
