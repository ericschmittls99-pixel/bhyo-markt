/**
 * Regel (3) des sektor-check fuer die geschuetzten Codes, als reine Funktion
 * (Test: sektor-regel.test.ts). Auf dem Stand von main (vor Migration 0035)
 * gilt E61: 'abnehmer' und 'ohne_sektor' existieren NICHT als Zeile. Ist die
 * Datenbank nachweislich voraus (Journal-Vergleich: nur spaetere
 * Migrationen, geteilte Preview), wird die Systemzeile 'ohne_sektor' aus
 * 0035 (E66, AP2.5 PR a1) toleriert und ausdruecklich benannt; 'abnehmer'
 * bleibt in jedem Modus verboten. Bei gleichem Journal ist 'ohne_sektor'
 * als Zeile rot (Rot-Nachweis im Test und per tmp-Branch).
 */
export type JournalModusName = "exakt" | "mindest" | "rot";

export function systemzeileRegel(modus: JournalModusName, vorhanden: readonly string[]): { fehler: string | null; hinweis: string | null } {
  const abnehmer = vorhanden.includes("abnehmer");
  const ohneSektor = vorhanden.includes("ohne_sektor");
  if (abnehmer) return { fehler: `Geschuetzte Codes existieren als Sektor: ${vorhanden.join(", ")}`, hinweis: null };
  if (ohneSektor && modus === "mindest") return { fehler: null, hinweis: "DB voraus – ohne_sektor (Systemzeile aus spaeterer Migration 0035) toleriert" };
  if (ohneSektor) return { fehler: "Geschuetzte Codes existieren als Sektor: ohne_sektor (gleiches Journal: auf diesem Stand darf die Zeile nicht existieren)", hinweis: null };
  return { fehler: null, hinweis: null };
}
