/**
 * E21 (22.09.2026): Vergleich der im Build enthaltenen Migrationen (Drizzle-
 * Journal) mit den in der Datenbank angewendeten (drizzle.__drizzle_migrations,
 * Spalte created_at traegt das Journal-`when` in Millisekunden). Pure Funktion
 * — der DB-Zugriff liegt beim Aufrufer (/api/health).
 *
 * Hintergrund: Am 22.09.2026 lief Production-Code gegen ein zurueckliegendes
 * Schema (0009/0010 fehlten) — /register brach, /api/health blieb gruen.
 */

export interface JournalEintrag {
  when: number;
  tag: string;
}

/** Tags der Migrationen, die der Build kennt, die DB aber nicht hat. */
export function fehlendeMigrationen(
  journal: JournalEintrag[],
  dbWhens: (number | string)[],
): string[] {
  const angewendet = new Set(dbWhens.map(Number));
  return journal.filter((e) => !angewendet.has(e.when)).map((e) => e.tag);
}
