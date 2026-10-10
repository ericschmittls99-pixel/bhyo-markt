// Abhaengigkeitsfrei — wird auch von der Client-Fehlerseite der Anwendung
// importiert (@bhyo/db/fehler), darf also keinen Postgres-Client mitziehen.
/**
 * Verstaendliche Meldung fuer Datenbankfehler, die aus dem Zeitbudget oder
 * einem Verbindungsabriss stammen. Alles andere bleibt, was es ist.
 */
export function dbFehlerMeldung(e: unknown): string | null {
  const code = (e as { code?: string } | null)?.code ?? "";
  const text = e instanceof Error ? e.message : String(e);
  if (code === "CONNECT_TIMEOUT" || /connect_timeout|CONNECT_TIMEOUT/i.test(text))
    return "Die Datenbank war nicht rechtzeitig erreichbar. Bitte die Seite neu laden.";
  if (code === "57014" || /statement timeout|canceling statement/i.test(text))
    return "Die Abfrage hat das Zeitbudget überschritten. Bitte enger filtern oder die Seite neu laden.";
  if (code === "CONNECTION_CLOSED" || code === "CONNECTION_ENDED" || /Network connection lost|connection (closed|ended|terminated)/i.test(text))
    return "Die Verbindung zur Datenbank ist abgerissen. Bitte die Seite neu laden.";
  return null;
}

/**
 * E73 (Eric 10.10.2026): job_lauf.fehler traegt nie `e.message` — ein
 * Drizzle-Fehler nennt Query und Parameter, darunter koennte eine Adresse
 * stehen. Stattdessen eine Fehlerklasse aus Konstruktor-Name und Code, ohne
 * Parameter: `db_fehler/PostgresError/23505`, `db_fehler/Error/CONNECT_TIMEOUT`,
 * `graph/gedrosselt`, `fehler/TypeError`. Drizzle legt den Postgres-Fehler in
 * `cause`; genommen wird die innerste bekannte Ebene (eine Stufe tief).
 */
const UNERLAUBT = /[^A-Za-z0-9_.-]/g;
const DB_CODES = /^(CONNECT_TIMEOUT|CONNECTION_CLOSED|CONNECTION_ENDED|CONNECTION_DESTROYED|[0-9A-Z]{5})$/;

function stueck(wert: unknown): string | null {
  if (typeof wert === "number") return String(wert);
  if (typeof wert !== "string") return null;
  const s = wert.replace(UNERLAUBT, "").slice(0, 40);
  return s || null;
}

export function fehlerKlasse(e: unknown): string {
  if (!(e instanceof Error)) return "fehler/unbekannt";
  // GraphFehler (apps/web/lib/mail/graph.ts) traegt die Ursache als Code, nie Inhalt.
  const ursache = stueck((e as { ursache?: unknown }).ursache);
  if (e.name === "GraphFehler" && ursache) return `graph/${ursache}`;
  const cause = (e as { cause?: unknown }).cause;
  const quelle = cause instanceof Error ? cause : e;
  const name = stueck(quelle.name) ?? "Error";
  const code = stueck((quelle as { code?: unknown }).code);
  const istDb = e.name === "DrizzleQueryError" || name === "PostgresError" || (code !== null && DB_CODES.test(code));
  return `${istDb ? "db_fehler" : "fehler"}/${name}${code ? `/${code}` : ""}`;
}

/** Sieht der Text wie eine Fehlerklasse aus (und nicht wie ein alter Freitext)? Nur solche druckt ein Leseweg. */
export const FEHLERKLASSE_MUSTER = /^(db_fehler|graph|fehler)\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/;
export function istFehlerKlasse(text: string | null | undefined): text is string {
  return typeof text === "string" && FEHLERKLASSE_MUSTER.test(text);
}
