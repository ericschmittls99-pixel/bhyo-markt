/**
 * Eigene Eingabeformate statt Browser-Verhalten (Review Eric, 24.09.2026).
 *
 * Zwei Befunde aus dem Praxistest hatten dieselbe Ursache: Die Formulare
 * verließen sich auf native Eingabetypen, deren Verhalten vom **Browser und
 * dessen Gebietsschema** abhängt, nicht von der Anwendung.
 *
 * - `type="month"` kennen Safari und Firefox nicht; dort fällt das Feld auf
 *   ein nacktes Textfeld zurück. `type="date"` können sie, deshalb ging das
 *   Erhebungsdatum weiter — genau das Bild, das Eric gesehen hat.
 * - `type="number"` folgt dem Gebietsschema des BROWSERS, nicht dem `lang`
 *   der Seite. Gemessen: `navigator.language` ist `en-US`, ein Feld mit dem
 *   Wert „1,5" wird dort auf „" zurückgesetzt — das Komma kam nie am Server
 *   an, obwohl der es längst versteht (`Number(v.replace(",", "."))`).
 *
 * Diese Funktionen sind rein: Eingaben rein, Ergebnis raus, kein `Date.now()`,
 * kein Gebietsschema. Was der Nutzer sieht, entscheidet die Anwendung.
 */

// ---------------------------------------------------------------- Monat

/** Kanonische Speicherform, wie sie Server und Datenbank sehen. */
const MONAT_KANONISCH = /^(\d{4})-(\d{2})$/;

/** `2027-01` → `01/2027`. Leer bleibt leer. */
export function monatAnzeige(kanonisch: string): string {
  const m = MONAT_KANONISCH.exec(kanonisch.trim());
  return m ? `${m[2]}/${m[1]}` : "";
}

/**
 * Nimmt, was Menschen tippen, und gibt die kanonische Form zurück — oder
 * `""`, solange die Eingabe noch nicht vollständig ist. Akzeptiert
 * `01/2027`, `1/2027`, `01.2027`, `01-2027`, `012027` und die kanonische
 * Form selbst, damit ein bestehender Wert beim Bearbeiten nicht verloren
 * geht.
 */
export function monatKanonisch(eingabe: string): string {
  const t = eingabe.trim();
  if (t === "") return "";

  const kanonisch = MONAT_KANONISCH.exec(t);
  if (kanonisch) return gueltig(+kanonisch[2]!) ? t : "";

  // MM/JJJJ und Verwandte.
  const getrennt = /^(\d{1,2})[./-](\d{4})$/.exec(t);
  if (getrennt) {
    const monat = +getrennt[1]!;
    return gueltig(monat) ? `${getrennt[2]}-${String(monat).padStart(2, "0")}` : "";
  }

  // MMJJJJ ohne Trenner.
  const kompakt = /^(\d{2})(\d{4})$/.exec(t);
  if (kompakt) {
    const monat = +kompakt[1]!;
    return gueltig(monat) ? `${kompakt[2]}-${kompakt[1]}` : "";
  }

  return "";
}

function gueltig(monat: number): boolean {
  return monat >= 1 && monat <= 12;
}

// -------------------------------------------------------------- Dezimal

/**
 * Speicherform → Anzeige: Punkt wird Komma. Sonst nichts — die Ziffern
 * bleiben, wie sie sind, damit die Anzeige nichts behauptet, was der Wert
 * nicht hergibt (keine Rundung, keine Tausenderpunkte im Eingabefeld).
 */
export function dezimalAnzeige(roh: string | null | undefined): string {
  if (roh == null) return "";
  return String(roh).replace(".", ",");
}

/**
 * Eingaben mit Punkt-Dreiergruppen und ohne Komma sind mehrdeutig: `10.000`
 * kann zehntausend heißen (deutsche Tausenderpunkte) oder zehn Komma null
 * null null. Beides ist plausibel — `10.000` t Rohmenge ebenso wie ein
 * TS-Anteil von `33.333` %.
 *
 * Deshalb wird hier NICHT geraten. Das Formular meldet solche Eingaben und
 * bittet um ein Komma. Die Alternative wäre in jeder Richtung ein stiller
 * Fehler: `Number("10.000")` ergibt 10 — drei Größenordnungen verschwinden
 * lautlos.
 */
export function istMehrdeutig(eingabe: string): boolean {
  const t = eingabe.trim().replace(/[\s\u00a0\u202f]/g, "");
  return !t.includes(",") && /^-?\d{1,3}(\.\d{3})+$/.test(t);
}

/**
 * Anzeige → Speicherform. Deterministische Regel statt Rateverfahren:
 *
 * 1. Kommt ein Komma vor, ist es das Dezimaltrennzeichen; Punkte sind dann
 *    Tausenderpunkte und fallen weg (`1.234,5` → `1234.5`).
 * 2. Sonst bleibt der Punkt als Dezimaltrennzeichen stehen (`1.5`) — wer
 *    ihn gewohnt ist, wird nicht umgewöhnt. Mehrdeutige Eingaben (siehe
 *    `istMehrdeutig`) bleiben unverändert und werden abgewiesen, statt
 *    still gedeutet zu werden.
 *
 * Gibt die Eingabe unverändert zurück, wenn daraus keine Zahl wird — die
 * bestehende Validierung meldet den Fehler, diese Funktion verschluckt ihn
 * nicht.
 */
export function dezimalKanonisch(eingabe: string): string {
  const t = eingabe.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (t === "") return "";
  if (t.includes(",")) return t.replace(/\./g, "").replace(",", ".");
  return t;
}
