/**
 * Sektor-Eingabe bei der Inline-Anlage eines Akteurs (POST /api/akteure).
 *
 * Seit Migration 0020 haengt an `akteur.sektor` ein Fremdschluessel auf die
 * Referenztabelle. Die Combobox schickte bis dahin Freitext — jede Eingabe
 * ausser den acht Codes scheiterte an der Datenbank, als 500 ohne Erklaerung
 * (E21-Verstoss, 25.09.2026). Jetzt: bekannter Code oder leer ("ohne
 * Sektor"); alles andere wird abgewiesen und GENANNT, damit ein falscher
 * Aufrufer auffaellt statt still zurechtgebogen zu werden.
 */
export type SektorEingabe = { ok: true; sektor: string | null } | { ok: false; fehler: string };

export function sektorAusEingabe(roh: unknown, bekannteCodes: readonly string[]): SektorEingabe {
  if (roh == null) return { ok: true, sektor: null };
  if (typeof roh !== "string") return { ok: false, fehler: "Sektor muss ein Code sein" };
  const wert = roh.trim();
  if (wert === "") return { ok: true, sektor: null };
  if (!bekannteCodes.includes(wert)) {
    return { ok: false, fehler: `Unbekannter Sektor „${wert}" — erlaubt sind nur die Werte der Auswahlliste` };
  }
  return { ok: true, sektor: wert };
}
