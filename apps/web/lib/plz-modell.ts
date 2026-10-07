import type { Adresse } from "./geocode";

/** Ergebnis der lokalen PLZ-Pruefung (SQL plz_pruefung, E68 PR 1). */
export interface PlzPruefung {
  /** false: PLZ nicht im Bestand — Eingabe wird abgewiesen (E68). */
  plzBekannt: boolean;
  /** Eingabe passt zu einem Ort der PLZ (Normalform oder Kurzform). */
  ortPasst: boolean;
  /** Alle Orte der PLZ (amtliche Gemeindenamen) fuer „Meinten Sie …?". */
  orte: string[];
}

export interface PlzTreffer {
  plz: string;
  /** Orte der PLZ (amtliche Gemeindenamen); genau einer = eindeutig, sonst entscheidet der Mensch. */
  orte: string[];
}

/** Was das Pruefergebnis dem Menschen sagt — eine Formulierung fuer Formular und Import. */
export function plzPruefungText(e: PlzPruefung, plz: string): string | null {
  if (!e.plzBekannt) return `PLZ ${plz} ist unbekannt — bitte prüfen.`;
  if (e.ortPasst) return null;
  if (e.orte.length === 0) return `Zur PLZ ${plz} ist kein Ort hinterlegt.`;
  const liste = e.orte.slice(0, 3).join(", ");
  return `Ort passt nicht zur PLZ ${plz} — meinten Sie ${liste}${e.orte.length > 3 ? " …" : ""}?`;
}

/**
 * Lokaler Treffer aus dem Pin als Adresse im bekannten Format (Art „plz":
 * kein Strassenanteil; der Ort nur, wenn die PLZ genau einen hat — plz_ort
 * traegt keine Geometrie, bei mehreren Orten waehlt der Mensch).
 */
export function plzTrefferZuAdresse(t: PlzTreffer, pin: { lng: number; lat: number }): Adresse & { orte: string[] } {
  return { art: "plz", strasse: null, hausnummer: null, plz: t.plz, ort: t.orte.length === 1 ? t.orte[0]! : null, kreis: null, land: null, lng: pin.lng, lat: pin.lat, orte: t.orte };
}
