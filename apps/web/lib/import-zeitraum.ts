/**
 * AP2.7 PR e: Zeitraum des Laufs — reine Helfer ohne Server-Bezug (eine
 * „use server"-Datei darf nur async-Funktionen exportieren).
 */

/** „JJJJ-MM-TT" (Lauf-Datum) -> „MM/JJJJ" (Formulartext der Zeile). */
export function monatAusDatum(d: string): string {
  return `${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

/** Zeilen, die vom Lauf-Zeitraum abhaengen: nicht uebersprungen, ohne eigenes Zeitraum-von oder -bis. */
export function zeilenOhneZeitraum(zeilen: readonly { status: string; felder: Record<string, string> }[]): number {
  return zeilen.filter((z) => z.status !== "uebersprungen" && (!z.felder.zeitraum_von || !z.felder.zeitraum_bis)).length;
}
