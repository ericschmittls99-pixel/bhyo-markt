/**
 * E39 (28.09.2026): Sortierung der Akkordeon-Einträge in auswertung.
 * (Mengen-Module: „feedstock je cluster." samt Materialarten, Output-Mengen
 * samt Produkten). Standard ist die heutige Reihenfolge des Modells (Menge
 * absteigend, Cluster nach Wert, Output-Gruppen in Definitionsreihenfolge);
 * nur die beiden anderen Sortierungen ordnen um. URL-Parameter `awsort`.
 */
export type Sortierung = "menge_ab" | "menge_auf" | "name";

export const SORTIERUNGEN: readonly [Sortierung, string][] = [
  ["menge_ab", "Menge absteigend"],
  ["menge_auf", "Menge aufsteigend"],
  ["name", "Name A–Z"],
];

export const SORTIERUNG_STANDARD: Sortierung = "menge_ab";

export function leseSortierung(roh: string | undefined): Sortierung {
  return SORTIERUNGEN.some(([k]) => k === roh) ? (roh as Sortierung) : SORTIERUNG_STANDARD;
}

/** Zeilen mit Anteil (pct) und Beschriftung — mehr braucht die Sortierung nicht. */
export interface SortierbareZeile {
  label: string;
  pct: number;
}

/**
 * Ordnet Zeilen (und über `unterVon` deren Unterzeilen) nach der Sortierung.
 * `menge_ab` gibt die Eingabe unverändert zurück — die Modellreihenfolge ist
 * bereits Menge absteigend, und die Logik soll sich nicht ändern.
 */
export function sortiereZeilen<T extends SortierbareZeile>(zeilen: T[], s: Sortierung): T[] {
  if (s === "menge_ab") return zeilen;
  const nachName = (a: T, b: T) => a.label.localeCompare(b.label, "de");
  return [...zeilen].sort(s === "name" ? nachName : (a, b) => a.pct - b.pct || nachName(a, b));
}
