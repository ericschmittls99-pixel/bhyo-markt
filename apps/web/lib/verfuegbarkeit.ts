import { fmtMonat } from "./format";
import {
  datumZuMonat,
  monatZuBis,
  monatZuVon,
  type FeldFehler,
} from "./formular-modell";

/**
 * Verfuegbarkeits-/Vergabe-Modell (AP1j PR 2) — reine Logik ohne Datenbank.
 * Der Status wird NIE gespeichert, immer abgeleitet (Prinzip wie Qualitaet
 * A-D); `heute` ist Parameter, damit die Ableitung deterministisch testbar
 * bleibt. Hierarchie und Konvention offener Enden:
 * docs/ap1j-handoff-verfuegbarkeit-vergabe.md.
 */

export type VerfuegbarkeitsStatus =
  | "abgelaufen"
  | "noch_nicht_verfuegbar"
  | "vergeben_extern"
  | "vergeben_bhyo"
  | "reserviert_bhyo"
  | "verfuegbar";

/** Vergabezeile auf Datenbank-Ebene (ISO-Daten, offene Enden = null). */
export interface VergabeDaten {
  vergebenVon: string | null;
  vergebenBis: string | null;
  vergebenAn: string | null;
  anBhyo: boolean;
}

export interface VerfuegbarkeitsErgebnis {
  status: VerfuegbarkeitsStatus;
  /** Randfall Handoff: Reservierung zusaetzlich zur externen Vergabe zeigen. */
  reserviertZusatz: boolean;
}

/** Pillen-Text (Kleinschreibung mit Schlusspunkt, V2) und spill-Ton — keine Ampel. */
export const VERFUEGBARKEIT_PILL: Record<
  VerfuegbarkeitsStatus,
  { text: string; tone: string }
> = {
  verfuegbar: { text: "verfügbar.", tone: "active" },
  vergeben_bhyo: { text: "vergeben (bhyo).", tone: "running" },
  vergeben_extern: { text: "vergeben (extern).", tone: "inactive" },
  reserviert_bhyo: { text: "reserviert (bhyo).", tone: "quiet" },
  noch_nicht_verfuegbar: { text: "noch nicht verfügbar.", tone: "quiet" },
  abgelaufen: { text: "abgelaufen.", tone: "inactive" },
};

/**
 * Erste zutreffende Regel gewinnt (Handoff-Hierarchie 1-5). Offene Enden
 * werden fuer die Pruefung durch Verfuegbarkeitsbeginn/-ende ersetzt.
 * ISO-Strings vergleichen lexikographisch korrekt — kein Date-Parsing noetig.
 */
export function leiteVerfuegbarkeitAb(
  heute: string,
  strom: { zeitraumVon: string; zeitraumBis: string; reserviertBhyo: boolean },
  vergaben: VergabeDaten[],
): VerfuegbarkeitsErgebnis {
  const kein = { reserviertZusatz: false };
  if (heute > strom.zeitraumBis) return { status: "abgelaufen", ...kein };
  if (heute < strom.zeitraumVon)
    return { status: "noch_nicht_verfuegbar", ...kein };

  const aktiv = vergaben.find(
    (v) =>
      heute >= (v.vergebenVon ?? strom.zeitraumVon) &&
      heute <= (v.vergebenBis ?? strom.zeitraumBis),
  );
  if (aktiv) {
    return {
      status: aktiv.anBhyo ? "vergeben_bhyo" : "vergeben_extern",
      reserviertZusatz: strom.reserviertBhyo && !aktiv.anBhyo,
    };
  }
  if (strom.reserviertBhyo) return { status: "reserviert_bhyo", ...kein };
  return { status: "verfuegbar", ...kein };
}

/** Anzeige eines Vergabezeitraums; offene Enden nach Handoff-Konvention. */
export function vergabeLabel(von: string | null, bis: string | null): string {
  if (von && bis) return `${fmtMonat(von)} – ${fmtMonat(bis)}`;
  if (bis) return `bis ${fmtMonat(bis)}`;
  return `ab ${fmtMonat(von)} (unbefristet)`;
}

// --- Formular-Ebene (Monats-Strings, "" = offenes Ende) ----------------------

export interface VergabeFormZeile {
  vonMonat: string;
  bisMonat: string;
  an: string;
  anBhyo: boolean;
}

/** Beide Daten leer = keine Vergabe (Handoff) — wird nie gespeichert. */
export function istLeereVergabe(zeile: VergabeFormZeile): boolean {
  return !zeile.vonMonat && !zeile.bisMonat;
}

/**
 * Die vier Handoff-Regeln; Keys passen zur Inline-Anzeige im Panel
 * (vergabe_<index>_von / _bis, Index = Position im uebergebenen Array,
 * Leerzeilen behalten ihren Index). Fuer die Ueberlappungspruefung werden
 * offene Enden durch Verfuegbarkeitsbeginn/-ende ersetzt; damit ist auch
 * "hoechstens ein offenes Ende je Richtung" abgedeckt — zwei offene Anfaenge
 * ueberlappen nach Normalisierung immer.
 */
export function validiereVergaben(
  vonMonat: string,
  bisMonat: string,
  zeilen: VergabeFormZeile[],
): FeldFehler {
  const f: FeldFehler = {};
  const belegt = zeilen
    .map((zeile, i) => ({ zeile, i }))
    .filter(({ zeile }) => !istLeereVergabe(zeile));

  for (const { zeile, i } of belegt) {
    if (zeile.vonMonat && zeile.bisMonat && zeile.bisMonat < zeile.vonMonat)
      f[`vergabe_${i}_bis`] = "Bis liegt vor Ab";
    if (vonMonat && zeile.vonMonat && zeile.vonMonat < vonMonat)
      f[`vergabe_${i}_von`] = "Liegt vor dem Verfügbarkeitsbeginn";
    if (bisMonat) {
      if (zeile.vonMonat && zeile.vonMonat > bisMonat)
        f[`vergabe_${i}_von`] = "Liegt nach dem Verfügbarkeitsende";
      if (zeile.bisMonat && zeile.bisMonat > bisMonat)
        f[`vergabe_${i}_bis`] = "Liegt nach dem Verfügbarkeitsende";
    }
  }

  const normalisiert = belegt
    .map(({ zeile, i }) => ({
      i,
      von: zeile.vonMonat || vonMonat,
      bis: zeile.bisMonat || bisMonat,
    }))
    .sort((a, b) => (a.von < b.von ? -1 : a.von > b.von ? 1 : a.i - b.i));
  for (let k = 1; k < normalisiert.length; k++) {
    if (normalisiert[k]!.von <= normalisiert[k - 1]!.bis)
      f[`vergabe_${normalisiert[k]!.i}_von`] =
        "Überschneidet sich mit einem anderen Vergabezeitraum";
  }
  return f;
}

/** Formular -> Persistenz: Leerzeilen weg, Monat -> Datum, leere Enden -> null. */
export function vergabenZuWerten(zeilen: VergabeFormZeile[]): VergabeDaten[] {
  return zeilen
    .filter((zeile) => !istLeereVergabe(zeile))
    .map((zeile) => ({
      vergebenVon: zeile.vonMonat ? monatZuVon(zeile.vonMonat) : null,
      vergebenBis: zeile.bisMonat ? monatZuBis(zeile.bisMonat) : null,
      vergebenAn: zeile.an.trim() || null,
      anBhyo: zeile.anBhyo,
    }));
}

/** Persistenz -> Formular (Edit-Prefill). */
export function vergabenZuFormZeilen(
  daten: VergabeDaten[],
): VergabeFormZeile[] {
  return daten.map((d) => ({
    vonMonat: datumZuMonat(d.vergebenVon),
    bisMonat: datumZuMonat(d.vergebenBis),
    an: d.vergebenAn ?? "",
    anBhyo: d.anBhyo,
  }));
}
