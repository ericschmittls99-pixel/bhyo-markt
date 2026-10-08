/**
 * E68 PR 1: Spiegel der SQL-Funktionen plz_ort_norm / plz_ort_passt aus
 * Migration 0048 (E72, Migration 0051: plz_ort_norm_passt auf Normalformen,
 * plz_ort_passt als Huelle) — eine Regel, zwei Laufzeiten. plz-check.ts
 * rechnet beide auf denselben Eingaben gegeneinander; weicht eine ab, ist
 * die CI rot.
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
 * Passt-Regel auf Normalformen (Spiegel von plz_ort_norm_passt, E72):
 * a) gleich; b) Kurzform — die Eingabe ist ein ganzes Wortpraefix des Orts
 * („ludwigshafen" -> „ludwigshafen am rhein", „ludwigs" nicht); c) Ortsteil
 * (E72 e, Eric 08.10.2026) — die Eingabe beginnt mit dem amtlichen Ort und
 * einem Wortende („mannheim neckarau" zu „mannheim"; „mannheimer str"
 * nicht). Bindestrich und Leerzeichen sind in der Normalform dasselbe.
 */
export function ortNormPasst(norm: string, ortNorm: string): boolean {
  return norm !== "" && ortNorm !== "" && (ortNorm === norm || ortNorm.startsWith(`${norm} `) || norm.startsWith(`${ortNorm} `));
}

/** Passt die Eingabe zu einem Ort (Spiegel von plz_ort_passt)? Normalisiert einmal, dann ortNormPasst. */
export function ortPasst(eingabe: string, ortNorm: string): boolean {
  return ortNormPasst(normalisiereOrt(eingabe), ortNorm);
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
  // E72 e (Eric 08.10.2026): Ortsteil-Toleranz — Ort mit Ortsteil passt, Strassenname nicht, fremder Ort nicht.
  ["Mannheim-Neckarau", "mannheim", true],
  ["Stuttgart Vaihingen", "stuttgart", true],
  ["Mannheimer Str.", "mannheim", false],
  ["Heidelberg-Rohrbach", "mannheim", false],
  ["Mannheim", "mannheim", true],
  ["x", "", false],
];
