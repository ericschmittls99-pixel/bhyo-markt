/**
 * AP2.9 (E74): Versand ueber Microsoft 365 per Graph `sendMail` — reine
 * Funktionen mit hereingereichtem `fetch`, kein Zugriff auf Umgebung oder
 * Datenbank. Token per client_credentials (Entra-App, Anwendungsberechtigung
 * Mail.Send, per ApplicationAccessPolicy auf das Absenderpostfach
 * beschraenkt), Versand als Anwendung im Namen des Postfachs,
 * saveToSentItems=false (kein Abbild im Postfach).
 *
 * E73: Fehlertexte nennen nie Secret, Token oder Empfaengeradressen —
 * nur die Ursache als Code, damit Logs gefahrlos bleiben.
 */

export interface GraphKonfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface MailNachricht {
  empfaenger: string;
  betreff: string;
  /** Reiner Text; HTML bewusst nicht vorgesehen, bis das Roundup es braucht. */
  text: string;
}

/** Ursache eines fehlgeschlagenen Schritts — als Code, nie mit Inhalten. */
export type GraphUrsache =
  | "secret_abgelaufen"
  | "secret_ungueltig"
  | "app_unbekannt"
  | "token_sonst"
  | "zugriff_verweigert"
  | "postfach_unbekannt"
  | "gedrosselt"
  | "netz"
  | "sonst";

export class GraphFehler extends Error {
  constructor(
    readonly ursache: GraphUrsache,
    readonly status: number | null,
    /** Sekunden aus Retry-After bei Drosselung, sonst null. */
    readonly wiederholenNach: number | null = null,
  ) {
    super(`Graph: ${ursache}${status == null ? "" : ` (HTTP ${status})`}`);
  }
}

export const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export function tokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

export function sendMailUrl(absender: string): string {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(absender)}/sendMail`;
}

/** Entra-Fehlercodes (AADSTS…) aus der Token-Antwort auf eine Ursache abbilden. */
export function tokenUrsache(status: number, fehlerCodes: readonly number[]): GraphUrsache {
  if (fehlerCodes.includes(7000222)) return "secret_abgelaufen";
  if (fehlerCodes.includes(7000215)) return "secret_ungueltig";
  if (fehlerCodes.includes(700016)) return "app_unbekannt";
  return status === 0 ? "netz" : "token_sonst";
}

/** Token der Anwendung holen. Wirft GraphFehler, nie mit Secret im Text. */
export async function holeGraphToken(konfig: GraphKonfig, holen: typeof fetch): Promise<{ token: string; laeuftAbInSekunden: number }> {
  const body = new URLSearchParams({
    client_id: konfig.clientId,
    client_secret: konfig.clientSecret,
    grant_type: "client_credentials",
    scope: GRAPH_SCOPE,
  });
  let res: Response;
  try {
    res = await holen(tokenUrl(konfig.tenantId), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  } catch {
    throw new GraphFehler("netz", null);
  }
  if (!res.ok) {
    let codes: number[] = [];
    try {
      const j = (await res.json()) as { error_codes?: unknown };
      if (Array.isArray(j.error_codes)) codes = j.error_codes.filter((c): c is number => typeof c === "number");
    } catch {
      // Antwort ohne JSON: Ursache bleibt "token_sonst".
    }
    throw new GraphFehler(tokenUrsache(res.status, codes), res.status);
  }
  const j = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof j.access_token !== "string" || j.access_token === "") throw new GraphFehler("token_sonst", res.status);
  return { token: j.access_token, laeuftAbInSekunden: typeof j.expires_in === "number" ? j.expires_in : 0 };
}

/** Request-Koerper fuer sendMail — exportiert, damit Tests die Form pruefen. */
export function sendMailKoerper(n: MailNachricht): { message: { subject: string; body: { contentType: "Text"; content: string }; toRecipients: { emailAddress: { address: string } }[] }; saveToSentItems: false } {
  return {
    message: {
      subject: n.betreff,
      body: { contentType: "Text", content: n.text },
      toRecipients: [{ emailAddress: { address: n.empfaenger } }],
    },
    saveToSentItems: false,
  };
}

/** Eine Mail als Anwendung im Namen des Absenderpostfachs senden (Graph antwortet 202). */
export async function sendeGraphMail(token: string, absender: string, nachricht: MailNachricht, holen: typeof fetch): Promise<void> {
  let res: Response;
  try {
    res = await holen(sendMailUrl(absender), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(sendMailKoerper(nachricht)),
    });
  } catch {
    throw new GraphFehler("netz", null);
  }
  if (res.status === 202) return;
  if (res.status === 429) {
    const ra = Number(res.headers.get("Retry-After"));
    throw new GraphFehler("gedrosselt", 429, Number.isFinite(ra) && ra > 0 ? ra : null);
  }
  if (res.status === 401 || res.status === 403) throw new GraphFehler("zugriff_verweigert", res.status);
  if (res.status === 404) throw new GraphFehler("postfach_unbekannt", 404);
  throw new GraphFehler("sonst", res.status);
}
