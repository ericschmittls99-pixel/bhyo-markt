/**
 * E21 (22.09.2026): Vorab-Check des Produktions-Schemas im Deploy-Workflow.
 * Vergleicht das Drizzle-Journal im Checkout mit drizzle.__drizzle_migrations
 * (created_at traegt das Journal-`when` in Millisekunden) — nur lesend, es
 * wird hier NIE migriert. Migrationen laufen ausschliesslich ueber den manuell
 * ausgeloesten Workflow migrate-production.yml (Leitplanke "Produktions-DB nur
 * mit ausdruecklicher Freigabe").
 *
 * Aufruf: tsx src/schema-gate.ts [stand]
 *   ohne Argument  Gate: Exit 1 mit Handlungsanweisung, wenn die DB hinter
 *                  dem Journal zurueckliegt
 *   "stand"        gibt den angewendeten Stand aus (Anzahl + letzte Migration)
 */
import { readFileSync } from "node:fs";

import postgres from "postgres";

interface JournalEintrag {
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"),
) as { entries: JournalEintrag[] };

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL fehlt.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, fetch_types: false });
let whens: number[] = [];
try {
  const rows = await sql`SELECT created_at FROM drizzle.__drizzle_migrations`;
  whens = rows.map((r) => Number(r.created_at));
} catch {
  // Migrationstabelle fehlt (nie migrierte DB) -> alles gilt als ausstehend.
} finally {
  await sql.end().catch(() => {});
}

const angewendet = new Set(whens);
const fehlend = journal.entries.filter((e) => !angewendet.has(e.when)).map((e) => e.tag);

if (process.argv[2] === "stand") {
  const letzte = journal.entries.filter((e) => angewendet.has(e.when)).at(-1);
  console.log(
    `Angewendet: ${whens.length} Migrationen, letzte laut Journal: ${letzte?.tag ?? "keine"}.`,
  );
  if (fehlend.length > 0) console.log(`Noch ausstehend: ${fehlend.join(", ")}`);
} else if (fehlend.length > 0) {
  console.error(
    `Migration ${fehlend.join(", ")} ausstehend — zuerst den Workflow "Migrate Production" ` +
      `ausfuehren (Actions -> Migrate Production -> Run workflow, Bestaetigung "production"). ` +
      `Bis dahin wird kein Code deployt; der laufende Worker passt zum aktuellen Schema.`,
  );
  process.exit(1);
} else {
  console.log(`Schema aktuell (${journal.entries.length} Migrationen angewendet).`);
}
