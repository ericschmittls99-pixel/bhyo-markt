import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Zeitbudget des Postgres-Clients (28.09.2026, Befund 1101 vom 26.09.):
 * Beim Worker-Austausch riss die Datenbankverbindung ("Network connection
 * lost"); eine Anfrage blieb ohne jedes Limit haengen, bis die Runtime sie
 * abbrach ("code had hung and would never generate a response"). Ein
 * Client ohne Zeitbudget macht aus einem Verbindungsabriss einen Haenger.
 *
 * - connect_timeout: 10 s fuer den Verbindungsaufbau (Hyperdrive/Neon
 *   antworten normalerweise in Millisekunden; 10 s ist bereits ein Ausfall).
 * - statement_timeout: 15 s serverseitig je Abfrage — die schwerste
 *   Abfrage der Anwendung liegt weit unter einer Sekunde.
 * - idle_timeout / max_lifetime: keine Verbindung wird ueber Minuten
 *   wiederverwendet; eine im Austausch gestorbene Verbindung faellt aus
 *   dem Pool, statt die naechste Anfrage zu blockieren.
 *
 * Der Fehler kommt dann kontrolliert an (siehe dbFehlerMeldung), statt als
 * 1101 der Runtime.
 */
export const DB_ZEITBUDGET = {
  connectTimeoutS: 10,
  statementTimeoutMs: 15_000,
  idleTimeoutS: 20,
  maxLifetimeS: 300,
} as const;

export function createSql(connectionString: string, overrides: postgres.Options<{}> = {}) {
  return postgres(connectionString, {
    max: 5,
    fetch_types: false,
    connect_timeout: DB_ZEITBUDGET.connectTimeoutS,
    idle_timeout: DB_ZEITBUDGET.idleTimeoutS,
    max_lifetime: DB_ZEITBUDGET.maxLifetimeS,
    connection: {
      statement_timeout: DB_ZEITBUDGET.statementTimeoutMs,
      application_name: "bhyo-markt",
    },
    ...overrides,
  });
}

/** Drizzle-Instanz mit angebundenem Schema fuer den Anwendungscode. */
export function createDb(connectionString: string) {
  return drizzle(createSql(connectionString), { schema });
}

export { dbFehlerMeldung } from "./fehler";
