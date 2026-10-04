/**
 * Journal-Vergleich fuer die DB-Checks (Entscheidung Eric 01.10.2026):
 * Auf die geteilte Preview migriert nur der PR, der als Naechster gemergt
 * wird; ein Entwurf dahinter kann der Preview dennoch vorauslaufen. Die
 * Checks vergleichen deshalb ihre Zaehler
 *   - EXAKT, wenn das Journal der DB dem des Heads entspricht,
 *   - als MINDESTVERGLEICH, wenn die DB nachweislich spaetere Migrationen
 *     als der Head traegt (alle Head-Migrationen sind da, dazu weitere) —
 *     die Ausgabe sagt es ausdruecklich („DB voraus: 0036 – Mindestvergleich"),
 *   - und bleiben rot, wenn die DB hinter dem Head ist oder anders abweicht.
 * Auf Production gilt immer der exakte Vergleich (Host ep-purple-glade).
 * Reine Funktion plus ein Lader, der Journal und Migrationstabelle liest.
 */
import { readFileSync } from "node:fs";

import type postgres from "postgres";

export const PRODUCTION_HOST = "ep-purple-glade-b2tra1g7";

export interface JournalEintrag {
  when: number;
  tag: string;
}

export type Vergleich =
  | { modus: "exakt"; grund: string }
  | { modus: "mindest"; voraus: number[]; grund: string }
  | { modus: "rot"; fehlend: string[]; fremd: number[]; grund: string };

export function vergleicheJournal(head: readonly JournalEintrag[], db: readonly number[], host: string): Vergleich {
  const dbSet = new Set(db);
  const headSet = new Set(head.map((e) => e.when));
  const fehlend = head.filter((e) => !dbSet.has(e.when)).map((e) => e.tag);
  const voraus = db.filter((w) => !headSet.has(w)).sort((a, b) => a - b);
  if (fehlend.length) return { modus: "rot", fehlend, fremd: voraus, grund: `DB hinter dem Head: ${fehlend.join(", ")} fehlt` };
  if (voraus.length === 0) return { modus: "exakt", grund: "Journal der DB entspricht dem Head" };
  if (host.includes(PRODUCTION_HOST)) return { modus: "rot", fehlend: [], fremd: voraus, grund: `Production traegt unbekannte Migrationen (${voraus.length}) — auf Production gilt der exakte Vergleich` };
  const letzteHead = Math.max(...head.map((e) => e.when));
  const nurSpaeter = voraus.every((w) => w > letzteHead);
  if (!nurSpaeter) return { modus: "rot", fehlend: [], fremd: voraus, grund: "DB weicht anders ab: unbekannte Migration vor dem Head-Stand" };
  return { modus: "mindest", voraus, grund: `DB voraus: ${voraus.length} spaetere Migration(en) – Mindestvergleich` };
}

/** Liest Head-Journal (Checkout) und Migrationstabelle der DB und entscheidet den Modus. */
export async function journalModus(sql: postgres.Sql, url: string): Promise<Vergleich & { headTags: string[]; vorausTags: string[] }> {
  const journal = JSON.parse(readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: JournalEintrag[] };
  const rows = (await sql`select created_at from drizzle.__drizzle_migrations`) as unknown as { created_at: string | number }[];
  const db = rows.map((r) => Number(r.created_at));
  const v = vergleicheJournal(journal.entries, db, new URL(url).hostname);
  const vorausTags = v.modus === "mindest" ? v.voraus.map((w) => `when=${w}`) : [];
  return { ...v, headTags: journal.entries.map((e) => e.tag), vorausTags };
}

/**
 * Zaehler-Vergleich im gewaehlten Modus: exakt = gleich; mindest = ist >= soll.
 * Liefert den Fehlertext oder null.
 */
export function zaehlerPasst(name: string, ist: number, soll: number, modus: "exakt" | "mindest"): string | null {
  if (modus === "mindest") return ist >= soll ? null : `${name}: ${ist} < ${soll} (Mindestvergleich)`;
  return ist === soll ? null : `${name}: ${ist} statt ${soll}`;
}

/** Ausgabe-Zeile fuer die Checks — nennt den Modus ausdruecklich. */
export function modusText(v: Vergleich): string {
  if (v.modus === "mindest") return `JOURNAL DB voraus (${v.voraus.length}) – Mindestvergleich`;
  if (v.modus === "exakt") return "JOURNAL gleich – exakter Vergleich";
  return `JOURNAL ROT – ${v.grund}`;
}
