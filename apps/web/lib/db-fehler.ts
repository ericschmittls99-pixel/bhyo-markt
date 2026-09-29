/**
 * Datenbankfehler lesen, statt sie als 500 durchzureichen.
 *
 * Die Constraints in der Datenbank sind die Wahrheit über Eindeutigkeit —
 * eine Vorprüfung per SELECT ist nur Komfort und kann veraltet sein
 * (Production-Fehler 29.09.2026: Der Hyperdrive-Abfrage-Cache lieferte einen
 * alten Stand, die Vorprüfung ging durch, das INSERT lief in den Schlüssel).
 * Jeder Schreibpfad, der vor dem INSERT/UPDATE auf Eindeutigkeit prüft, muss
 * die Antwort der Datenbank deshalb verstehen und klar melden.
 */

/** SQLSTATE der Postgres-Klasse „Integrity Constraint Violation", Unique. */
export const SQLSTATE_UNIQUE_VIOLATION = "23505";

function sqlstate(fehler: unknown): string | undefined {
  if (typeof fehler !== "object" || fehler === null) return undefined;
  const code = (fehler as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Ist das eine Unique-Verletzung? postgres.js hängt `code` direkt an den
 * Fehler; Drizzle (ab 0.44) packt ihn in einen DrizzleQueryError und legt das
 * Original in `cause`. Beide Formen werden erkannt, tiefer wird nicht gesucht.
 */
export function istEindeutigkeitsVerletzung(fehler: unknown): boolean {
  if (sqlstate(fehler) === SQLSTATE_UNIQUE_VIOLATION) return true;
  const ursache = (fehler as { cause?: unknown } | null)?.cause;
  return sqlstate(ursache) === SQLSTATE_UNIQUE_VIOLATION;
}
