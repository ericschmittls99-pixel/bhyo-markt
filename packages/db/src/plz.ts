/**
 * E68 PR 1: Spiegel der SQL-Funktionen plz_ort_norm / plz_ort_passt aus
 * Migration 0048 — eine Regel, zwei Laufzeiten. plz-check.ts rechnet beide
 * auf denselben Eingaben gegeneinander; weicht eine ab, ist die CI rot.
 */

/** Uebliche Normalisierung eines Ortsnamens (Spiegel von plz_ort_norm). */
export function normalisiereOrt(t: string): string {
  return t
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Passt die Eingabe zu einem Ort (Spiegel von plz_ort_passt)? Gleichheit der
 * Normalform oder Kurzform: die Eingabe ist ein ganzes Wortpraefix
 * („ludwigshafen" -> „ludwigshafen am rhein"). „ludwigs" passt nicht.
 */
export function ortPasst(eingabe: string, ortNorm: string): boolean {
  const e = normalisiereOrt(eingabe);
  return e !== "" && (ortNorm === e || ortNorm.startsWith(`${e} `));
}

/** Gemeinsame Pruef-Faelle fuer Vitest (TS) und plz-check (SQL). */
export const ORT_NORM_FAELLE: ReadonlyArray<readonly [string, string]> = [
  ["Speyer", "speyer"],
  ["  Ludwigshafen am Rhein ", "ludwigshafen am rhein"],
  ["Dannstadt-Schauernheim", "dannstadt schauernheim"],
  ["Frankfurt (Oder)", "frankfurt oder"],
  ["Mühlhausen/Thüringen", "muehlhausen thueringen"],
  ["Groß Köris", "gross koeris"],
  ["ÖHRINGEN", "oehringen"],
  ["Sankt   Blasien", "sankt blasien"],
  ["", ""],
  ["---", ""],
];

export const ORT_PASST_FAELLE: ReadonlyArray<readonly [string, string, boolean]> = [
  ["Speyer", "speyer", true],
  ["speyer ", "speyer", true],
  ["Ludwigshafen", "ludwigshafen am rhein", true],
  ["Ludwigshafen am Rhein", "ludwigshafen am rhein", true],
  ["Ludwigs", "ludwigshafen am rhein", false],
  ["Halle", "halle saale", true],
  ["Halle (Saale)", "halle saale", true],
  ["Frankfurt", "frankfurt oder", true],
  ["Frankfurt am Main", "frankfurt oder", false],
  ["Mannheim", "speyer", false],
  ["", "speyer", false],
  ["%", "speyer", false],
];
