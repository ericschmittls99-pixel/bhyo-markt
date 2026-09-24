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
 *                  dem Journal zurueckliegt; Exit 2, wenn die DB nicht
 *                  erreichbar ist (kein Schema-Befund — andere Fehlerklasse)
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

// Zielnachweis vor dem Urteil (Review Eric, 24.09.2026): Ein Gate, dessen
// Ziel nicht im Log steht, erfuellt die Nachweisregel nicht — auch dann
// nicht, wenn es nichts migriert. Gleiches Format wie pre-drop-check und die
// DB-Checks, damit sich Laeufe vergleichen lassen. Nur Host und Datenbank,
// nie die vollstaendige URL (sie traegt das Passwort).
const ziel = new URL(url);
console.log(`GATE host=${ziel.hostname} db=${ziel.pathname.slice(1)}`);

// Zwei Fehlerklassen, die NICHT dieselbe Meldung bekommen duerfen (Review
// Eric 22.09.2026): Eine fehlende Migrationstabelle (Postgres 42P01,
// undefined_table) ist ein echter Schema-Befund — nie migrierte DB, alles
// ausstehend. Jeder andere Fehler (Timeout, Auth, DNS) ist KEIN Befund zum
// Schema-Stand; wer beide vermischt, trainiert sich an, Blockaden per
// Neustart wegzuklicken. Neon suspendiert bei Inaktivitaet, deshalb faengt
// eine kurze Retry-Schleife den Kaltstart ab, bevor "nicht erreichbar"
// gemeldet wird.
const VERSUCHE = 3;
const WARTE_MS = 5000;

// Node verpackt parallele Connect-Fehler (IPv4+IPv6) als AggregateError,
// dessen String-Form die Ursache verschluckt — fuer die Meldung auspacken.
function fehlerText(f: unknown): string {
  if (f instanceof AggregateError && f.errors[0] !== undefined) return String(f.errors[0]);
  return f instanceof Error ? `${f.name}: ${f.message}` : String(f);
}

let whens: number[] | null = null;
let letzterFehler: unknown;
for (let versuch = 1; versuch <= VERSUCHE && whens === null; versuch++) {
  const sql = postgres(url, { max: 1, fetch_types: false, connect_timeout: 20 });
  try {
    const rows = await sql`SELECT created_at FROM drizzle.__drizzle_migrations`;
    whens = rows.map((r) => Number(r.created_at));
  } catch (fehler) {
    if ((fehler as { code?: string }).code === "42P01") {
      whens = []; // Migrationstabelle fehlt: nie migrierte DB, alles ausstehend.
    } else {
      letzterFehler = fehler;
      console.error(`Verbindungsversuch ${versuch}/${VERSUCHE} fehlgeschlagen: ${fehlerText(fehler)}`);
      if (versuch < VERSUCHE) await new Promise((r) => setTimeout(r, WARTE_MS));
    }
  } finally {
    await sql.end().catch(() => {});
  }
}

if (whens === null) {
  console.error(
    `Produktions-DB nicht erreichbar (${VERSUCHE} Versuche): ${fehlerText(letzterFehler)}. ` +
      `Das ist KEIN Schema-Rueckstand, sondern ein Verbindungsproblem — es gibt keinen ` +
      `Befund zum Schema-Stand. Moegliche Ursache: Neon-Kaltstart oder Netz. ` +
      `Lauf erneut starten; bei wiederholtem Fehlschlag DB-Status in Neon pruefen. ` +
      `NICHT der Fall "Migration ausstehend" — Migrate Production hilft hier nicht.`,
  );
  process.exit(2);
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
