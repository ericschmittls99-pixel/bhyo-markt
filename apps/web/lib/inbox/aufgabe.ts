/**
 * AP2.4 PR c (E63, D5): Regeln des Aufgabentexts beim Weitergeben — vorbefuellt
 * „Bitte aktualisieren", frei aenderbar, nicht leer, hoechstens 500 Zeichen.
 * Dieselbe Regel steht als CHECK inbox_eintrag_aufgabe_check in der Datenbank
 * (Migration 0034); hier die Meldung fuer die Oberflaeche.
 */
export const AUFGABE_VORGABE = "Bitte aktualisieren";
export const AUFGABE_MAX = 500;

export type AufgabePruefung = { ok: true; text: string } | { ok: false; fehler: string };

/** Rand abgeschnitten; leer oder zu lang = Fehler mit Meldung. */
export function pruefeAufgabe(eingabe: string | null | undefined): AufgabePruefung {
  const text = (eingabe ?? "").trim();
  if (!text) return { ok: false, fehler: "Der Aufgabentext darf nicht leer sein." };
  if (text.length > AUFGABE_MAX) return { ok: false, fehler: `Der Aufgabentext darf höchstens ${AUFGABE_MAX} Zeichen haben.` };
  return { ok: true, text };
}
