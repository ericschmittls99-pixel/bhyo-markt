/**
 * E39 (28.09.2026): Bedienlogik des Jahres-Reglers in auswertung. — ersetzt
 * die anklickbaren Jahr-Pillen. Die JAHRES-LOGIK selbst (Achse, Rückfälle,
 * Fensterrechnung in auswertung/page.tsx und lib/fenster.ts) bleibt
 * unverändert; hier steht nur, was der Regler anzeigt und beim Bedienen in
 * die URL schreibt. Rein, ohne Datum: die Achse kommt vom Aufrufer.
 */

/** Grenzen des Reglers: frühestes bis spätestes Jahr der (gedeckelten) Pool-Achse. */
export function reglerGrenzen(achse: readonly number[]): { min: number; max: number } {
  if (achse.length === 0) throw new Error("Jahresachse ist leer — poolJahresAchse liefert mindestens das aktuelle Jahr.");
  return { min: achse[0]!, max: achse[achse.length - 1]! };
}

export function klemme(wert: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(wert)));
}

/** Zusammenhängende Jahresliste von..bis (Reihenfolge der Griffe egal). */
export function jahreImBereich(a: number, b: number): number[] {
  const von = Math.min(a, b);
  const bis = Math.max(a, b);
  return Array.from({ length: bis - von + 1 }, (_, i) => von + i);
}

/** Von/Bis einer Auswahl — auch einer lückenhaften aus einer alten Adresse. */
export function bereichVon(jahre: readonly number[]): { von: number; bis: number } {
  return { von: Math.min(...jahre), bis: Math.max(...jahre) };
}

/** Wechsel Zeitraum → Einzeljahr: das Endjahr gilt. */
export function beimWechselZuEinzeljahr(jahre: readonly number[]): number {
  return bereichVon(jahre).bis;
}

/** Wechsel Einzeljahr → Zeitraum: der Zeitraum [Jahr, Jahr]. */
export function beimWechselZuZeitraum(jahr: number): number[] {
  return jahreImBereich(jahr, jahr);
}

/** Text neben dem Uhr-Icon: „2026" bzw. „2023–2026". */
export function uhrText(zeitmodus: "einzeljahr" | "zeitraum", jahre: readonly number[]): string {
  if (zeitmodus === "einzeljahr" || jahre.length === 0) return String(jahre[0] ?? "");
  const { von, bis } = bereichVon(jahre);
  return von === bis ? String(von) : `${von}–${bis}`;
}

/** URL-Wert des Parameters `jahre` (Kommaliste, wie bisher). */
export function jahreParam(jahre: readonly number[]): string {
  return jahre.join(",");
}
