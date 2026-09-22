import { fmtMonat } from "./format";

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
