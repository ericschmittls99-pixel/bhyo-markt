import { ANSICHTEN, type Ansicht } from "./filter-modell";
import {
  filterAusSearchParams,
  filterStroeme,
  type SearchParamsRoh,
  type Strom,
} from "./stroeme-modell";

/**
 * Zeilenauswahl des CSV-Exports — rein, ohne DB, damit sie sich gegen die
 * Liste testen laesst.
 *
 * Produktionsfehler (26.09.2026): Die Route filterte IMMER im Scope
 * "auswertung". Von stroeme. aus fielen damit Freitext, Verfuegbarkeit und
 * "Verfuegbar ab" still weg — die Datei enthielt mehr Zeilen, als die Liste
 * zeigte. Der Scope kommt jetzt von der aufrufenden Ansicht (`ansicht=`).
 * Ohne oder mit unbekanntem Parameter bleibt "auswertung" der Standard, weil
 * der Knopf dort entstanden ist (E9) und alte Adressen so weiter stimmen.
 */
export function exportAnsicht(roh: string | null | undefined): Ansicht {
  return roh && (ANSICHTEN as readonly string[]).includes(roh) ? (roh as Ansicht) : "auswertung";
}

export function exportZeilen(pool: Strom[], sp: SearchParamsRoh): Strom[] {
  const filter = filterAusSearchParams(sp);
  const ansicht = exportAnsicht(Array.isArray(sp.ansicht) ? sp.ansicht[0] : sp.ansicht);
  return filterStroeme(pool, filter, ansicht);
}
