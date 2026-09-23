// Saisonalitaet als INDEX (Umbau 23.09.2026): 100 = Durchschnittsmonat.
// Die zwoelf gespeicherten Zahlen sind SKALENFREI — nur die Verhaeltnisse
// zaehlen (anteil_m = wert_m / Summe). Bestandsdaten (alte Konvention
// Summe = 100) liefern damit exakt die bisherigen Anteile; es gibt KEINE
// Migration und KEINE Normierung beim Speichern. Wer die Werte "gut
// gemeint" auf eine Summe normiert, aendert nichts an den Anteilen,
// zerstoert aber die Editor-Historie — bleiben lassen.

import { rundeAnteile100 } from "./format";

/** Jahresanteil eines Monats als Bruch (0..1); leer/0-Profil = 1/12. */
export function saisonAnteilBruch(werte: number[] | null, monat: number): number {
  if (!werte || werte.length !== 12) return 1 / 12;
  const summe = werte.reduce((a, b) => a + b, 0);
  if (summe <= 0) return 1 / 12;
  return (werte[monat] ?? 0) / summe;
}

/**
 * Abgeleitete Jahresanteile in Prozent fuer die Anzeige: ganzzahlig per
 * Largest Remainder, Summe exakt 100 (E20). Null-Profil -> zwoelf Nullen.
 */
export function saisonAnteileProzent(werte: number[]): number[] {
  const summe = werte.reduce((a, b) => a + b, 0);
  if (summe <= 0) return Array(12).fill(0);
  return rundeAnteile100(werte.map((v) => (v / summe) * 100));
}

/**
 * Editor-Ansicht: normiert einmalig beim Laden aufs Mittel 100, damit die
 * Referenzlinie (100 = Durchschnittsmonat) fuer jede gespeicherte Skala
 * stimmt — Bestand in Alt-Konvention (Summe 100) erscheint so korrekt um
 * die Linie statt flach am Boden. Verhaeltnisse bleiben exakt erhalten.
 */
export function saisonZuIndex(werte: number[]): number[] {
  const summe = werte.reduce((a, b) => a + b, 0);
  if (summe <= 0) return werte.map(() => 0);
  return werte.map((v) => (v / summe) * 1200);
}

/**
 * Feste Achse 0-200 %; liegt ein Wert darueber (nur per Zahlenfeld
 * moeglich), springt sie auf den naechsten 50er-Schritt oberhalb des
 * groessten Werts. Keine kontinuierlich mitwachsende Achse — sie folgt
 * nur dem Spitzenwert, nie dem Ziehen (das bei 200 kappt).
 */
export function saisonAchse(werte: number[]): number {
  const max = Math.max(0, ...werte);
  return Math.max(200, Math.ceil(max / 50) * 50);
}
