import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * Roher Postgres-Client fuer den Worker. Der Verbindungsstring kommt aus der
 * Hyperdrive-Bindung (`env.HYPERDRIVE.connectionString`), nie aus dem Repo.
 * `fetch_types: false` spart beim Verbindungsaufbau die Typ-Introspektion —
 * fuer kurzlebige Worker-Verbindungen ueber Hyperdrive empfohlen.
 */
export function createSql(connectionString: string) {
  return postgres(connectionString, { max: 5, fetch_types: false });
}

/** Drizzle-Instanz mit angebundenem Schema fuer den spaeteren Anwendungscode. */
export function createDb(connectionString: string) {
  return drizzle(createSql(connectionString), { schema });
}
