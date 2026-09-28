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
