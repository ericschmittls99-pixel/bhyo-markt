/**
 * AP2.4 PR a (E62): Verifikationszustand eines Stroms — abgeleitet, nie
 * gespeichert (E23). Die Wahrheit liegt in der SQL-Funktion
 * strom_verifikation(stichtag) (Migration 0032), mengenbasiert fuer Liste,
 * Detail, Filter, Export und Job; hier stehen nur Typen, Labels und Pillen.
 *
 * verifiziert_am = letztes Ereignis geprueft/reverifiziert (solange der Strom
 * geprueft ist); verifiziert_bis = gueltig_bis bei den oberen vier Belegtypen,
 * sonst Kalendertag Berlin von verifiziert_am + Typ-Frist (parameter_wert an
 * diesem Tag). Die alte E33-Gesamtfaelligkeit (Belegfrist ab Erhebung,
 * Verfuegbarkeitsende, Vergabe-Enden, Reservierung) ist damit abgeloest:
 * Verfuegbarkeit und Vergaben haben den Verfuegbarkeits-Filter, das
 * Reservierungsveralten ist ein Nebentag dort (E64).
 */
export type VerifikationsZustand =
  | "ungeprueft"
  | "in_pruefung"
  | "gueltig"
  /** PR b: verifiziert_bis − Vorlauf ≤ heute — bis dahin liefert die Funktion ihn nicht. */
  | "laeuft_bald_ab"
  | "abgelaufen"
  | "als_abgelaufen_markiert"
  /** Geprueft ohne erkennbares Pruefereignis (Altbestand) oder ohne Beleg — gilt als faellig. */
  | "pruefdatum_unbekannt";

/** Reihenfolge = Anzeige-Reihenfolge der Filteroptionen; laeuft_bald_ab kommt mit PR b in die Liste. */
export const VERIFIKATION_ZUSTAENDE: readonly VerifikationsZustand[] = [
  "ungeprueft",
  "in_pruefung",
  "gueltig",
  "abgelaufen",
  "als_abgelaufen_markiert",
  "pruefdatum_unbekannt",
];

export const VERIFIKATION_LABEL: Record<VerifikationsZustand, string> = {
  ungeprueft: "ungeprüft",
  in_pruefung: "in Prüfung",
  gueltig: "gültig",
  laeuft_bald_ab: "läuft bald ab",
  abgelaufen: "abgelaufen",
  als_abgelaufen_markiert: "als abgelaufen markiert",
  pruefdatum_unbekannt: "Prüfdatum unbekannt",
};

export interface VerifikationsErgebnis {
  zustand: VerifikationsZustand;
  /** ISO-Zeitpunkt des letzten Pruefens; null ohne Pruefereignis. */
  verifiziertAm: string | null;
  /** JJJJ-MM-TT; null ohne Frist (ungeprueft, in_pruefung, Pruefdatum unbekannt). */
  verifiziertBis: string | null;
}

export function istVerifikationsZustand(wert: string): wert is VerifikationsZustand {
  return wert in VERIFIKATION_LABEL;
}

/** Zustaende, in denen der Strom als faellig gilt (Erinnerung, „drei naechste"). */
export const FAELLIGE_ZUSTAENDE: readonly VerifikationsZustand[] = ["abgelaufen", "pruefdatum_unbekannt"];

/**
 * Pillen-Text (Kleinschreibung mit Schlusspunkt, V2) und Ton — keine Ampel.
 * „gueltig" nennt das Datum: „gültig bis 12.03.2027."
 */
export function verifikationPill(
  v: VerifikationsErgebnis,
  fmtDatum: (iso: string) => string,
): { text: string; tone: string } {
  switch (v.zustand) {
    case "gueltig":
      return { text: v.verifiziertBis ? `gültig bis ${fmtDatum(v.verifiziertBis)}.` : "gültig.", tone: "running" };
    case "laeuft_bald_ab":
      return { text: v.verifiziertBis ? `läuft ab am ${fmtDatum(v.verifiziertBis)}.` : "läuft bald ab.", tone: "active" };
    case "abgelaufen":
      return { text: v.verifiziertBis ? `abgelaufen seit ${fmtDatum(v.verifiziertBis)}.` : "abgelaufen.", tone: "inactive" };
    case "als_abgelaufen_markiert":
      return { text: "abgelaufen.", tone: "inactive" };
    case "pruefdatum_unbekannt":
      return { text: "prüfdatum unbekannt.", tone: "inactive" };
    case "in_pruefung":
      return { text: "in prüfung.", tone: "active" };
    case "ungeprueft":
      return { text: "ungeprüft.", tone: "quiet" };
  }
}

/**
 * Sortierschluessel fuer „naechste Verifikation" (Auswertung): Abgelaufene
 * und Prüfdatum-unbekannt zuerst (aelteste zuerst), dann Gueltige nach
 * verifiziert_bis aufsteigend. Ungeprueft/in Pruefung haben keine Frist.
 */
export function verifikationsRang(v: VerifikationsErgebnis | undefined): [number, string] | null {
  if (!v) return null;
  if (v.zustand === "abgelaufen") return [0, v.verifiziertBis ?? ""];
  if (v.zustand === "pruefdatum_unbekannt") return [1, ""];
  if (v.zustand === "gueltig" || v.zustand === "laeuft_bald_ab") return [2, v.verifiziertBis ?? "9999-12-31"];
  return null;
}
