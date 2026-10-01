/**
 * AP2.3 (E59/E60): Parameter mit Verlauf — reine Regeln ohne Datenbank.
 * Die Wahrheit ueber „welcher Wert gilt am Stichtag" liegt in der SQL-
 * Funktion parameter_wert(); hier stehen nur Eingabepruefung und Anzeige.
 */
export interface ParameterDefinition {
  schluessel: string;
  bezeichnung: string;
  einheit: string;
  min: number;
  max: number;
  beschreibung: string;
}

/** Benannter Zustand der Startwerte: gueltig_ab = '-infinity'. */
export const SEIT_EINFUEHRUNG = "seit Einführung";

export function istSeitEinfuehrung(gueltigAb: string): boolean {
  return gueltigAb === "-infinity" || gueltigAb.startsWith("-infinity");
}

export type ParameterAblehnung =
  | { grund: "unbekannt"; text: string }
  | { grund: "wert"; text: string }
  | { grund: "datum"; text: string }
  | { grund: "begruendung"; text: string };

/**
 * Eingabe einer Aenderung: Wert im Bereich der Definition, gueltig ab heute
 * oder spaeter (nie rueckwirkend), Begruendung Pflicht. Dieselben Regeln
 * sichern CHECK und Trigger in der Datenbank (Migration 0029).
 */
export function pruefeParameterEingabe(
  def: ParameterDefinition | undefined,
  eingabe: { wert: number; gueltigAb: string; begruendung: string },
  heute: string,
): ParameterAblehnung | null {
  if (!def) return { grund: "unbekannt", text: "Unbekannter Parameter." };
  if (!Number.isInteger(eingabe.wert) || eingabe.wert < def.min || eingabe.wert > def.max) {
    return { grund: "wert", text: `Der Wert muss zwischen ${def.min} und ${def.max} ${einheitLabel(def.einheit)} liegen.` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eingabe.gueltigAb) || Number.isNaN(new Date(`${eingabe.gueltigAb}T00:00:00Z`).getTime())) {
    return { grund: "datum", text: "Bitte ein gültiges Datum angeben." };
  }
  if (eingabe.gueltigAb < heute) {
    return { grund: "datum", text: "Eine Änderung gilt nie rückwirkend — frühestens ab heute." };
  }
  if (eingabe.begruendung.trim().length === 0) {
    return { grund: "begruendung", text: "Bitte eine Begründung angeben." };
  }
  return null;
}

export function einheitLabel(einheit: string): string {
  if (einheit === "monate") return "Monate";
  if (einheit === "tage") return "Tage";
  return einheit;
}

/** Anzeige eines Werts mit Einheit: „3 Monate". */
export function wertMitEinheit(wert: number, einheit: string): string {
  if (einheit === "monate") return `${wert} ${wert === 1 ? "Monat" : "Monate"}`;
  if (einheit === "tage") return `${wert} ${wert === 1 ? "Tag" : "Tage"}`;
  return `${wert} ${einheit}`;
}

/** Gruppen der Parameter-Seite: Praefix des Schluessels → Ueberschrift. */
export const PARAMETER_GRUPPEN: Record<string, string> = {
  verifikationsfrist: "Verifikationsfristen",
  // AP2.4 PR b (E63): Vorlauf der Ablauf-Hinweise.
  verifikation: "Verifikation",
};

export function gruppeVon(schluessel: string): string {
  return PARAMETER_GRUPPEN[schluessel.split(".")[0]!] ?? "Weitere";
}
