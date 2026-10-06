/**
 * AP2.7 PR b (E67): Marker der Spalten-Zuordnung, die auch der Browser
 * braucht — eigene kleine Datei, damit die Oberflaeche nicht das ganze
 * Zuordnungsmodell (und mit import-modell das DB-Schema) buendelt.
 */
export const PERSON = "person";
export const IGNORIEREN = "ignorieren";

/** Stapelgroesse Probelauf/Ausfuehren (E67: ≈100 Zeilen je Request, 33 ms je Zeile gemessen). */
export const PROBELAUF_JE_STAPEL = 100;
