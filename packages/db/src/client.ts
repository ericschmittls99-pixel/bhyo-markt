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
  const client = postgres(connectionString, {
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
  sichereDateParameter(client.options.serializers);
  return client;
}

/**
 * Postgres-OIDs der skalaren Zeittypen: date, time, timestamp, timestamptz.
 * Arrays (1182, 1185, …) bleiben aussen vor — ein Date steht dort nie allein.
 */
const ZEIT_TYPEN = [1082, 1083, 1114, 1184] as const;

/**
 * Fehlerklasse „Date-Objekt im sql-Template" (Eric 12.10.2026; dritter Fall nach den
 * Proben in #215/#223 und dem Roundup-Job, Lauf 38255670920): postgres-js leitet aus
 * einem Date den Typ timestamptz ab und ruft den Serializer dieses Typs. Drizzle setzt
 * in construct() die Serializer der Zeittypen auf die Identitaet, weil es Spaltenwerte
 * selbst wandelt — ein Date OHNE Spaltenzuordnung erreicht den Puffer dann roh
 * (ERR_INVALID_ARG_TYPE). Weil Drizzle die Serializer NACH createSql in dasselbe Objekt
 * schreibt, haengt hier ein Setter an jedem Zeittyp: was immer spaeter zugewiesen wird,
 * bekommt ein Date als ISO-Text vorgesetzt. Alles andere (Text, Drizzles eigene
 * Wandlung) laeuft unveraendert durch. Nachweis: client.test.ts und
 * date-parameter-check.ts (Wegwerf-DB, echter Bind).
 */
function sichereDateParameter(serializers: Record<number, (x: unknown) => unknown>) {
  for (const oid of ZEIT_TYPEN) {
    let aktuell = serializers[oid] ?? ((x: unknown) => x);
    Object.defineProperty(serializers, oid, {
      configurable: true,
      enumerable: true,
      get: () => (x: unknown) => (x instanceof Date ? x.toISOString() : aktuell(x)),
      set: (fn: (x: unknown) => unknown) => {
        aktuell = fn;
      },
    });
  }
}

/** Drizzle-Instanz mit angebundenem Schema fuer den Anwendungscode. */
export function createDb(connectionString: string) {
  return drizzle(createSql(connectionString), { schema });
}

export { dbFehlerMeldung } from "./fehler";
