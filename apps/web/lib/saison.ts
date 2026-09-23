// Saisonalitaet als INDEX (Umbau 23.09.2026), Referenzmarke "100 %".
// (Bewusst NICHT "Durchschnittsmonat": ohne Normierung ist der Mittelwert
// der zwoelf Werte beliebig — bei einem Erntegipfel liegt er unter 100.)
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
 * Editor-Ansicht: normiert einmalig beim Laden aufs Mittel 100, damit
 * Bestand in Alt-Konvention (Summe 100) um die 100-%-Referenzlinie
 * erscheint statt flach am Boden. Verhaeltnisse bleiben exakt erhalten.
 * Nach dem Editieren gilt die Mittel-100-Eigenschaft nicht mehr — die
 * Linie ist eine Referenzmarke, kein Durchschnitt.
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

/**
 * "Profil strecken": skaliert alle zwoelf Werte so, dass der groesste bei
 * 200 liegt — Form und abgeleitete Anteile bleiben identisch (nur
 * Verhaeltnisse zaehlen). Zweck: Aufloesung zurueckgewinnen, wenn man
 * sich nach unten gearbeitet hat, statt ueber den 200er-Deckel zu wollen.
 * Bewusst OHNE Rundung, damit die Anteile exakt unveraendert bleiben.
 */
export function saisonStrecken(werte: number[]): number[] {
  const max = Math.max(0, ...werte);
  if (max <= 0) return [...werte];
  const faktor = 200 / max;
  return werte.map((v) => v * faktor);
}
