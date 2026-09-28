import { ROLLEN, type Rolle, type Zugang } from "./rollen";

/**
 * E42 (AP2.1): DIE Rechte-Matrix — eine Stelle, Daten statt verstreuter
 * Bedingungen. Eine Aktion steht hier erst, wenn es ihren Schreibpfad gibt
 * (Leitregel AP2); eine Rolle kommt erst mit ihrer ersten Wirkung.
 * Hierarchie admin ⊇ bearbeiter ⊇ betrachter ist hier ausgeschrieben, nicht
 * als Rang gerechnet — was eine Rolle darf, liest man ab, man leitet es
 * nicht her. Lesen ist keine Aktion dieser Matrix: Wer einen Zugang hat
 * (angemeldet, eingetragen, aktiv), liest; das prueft die Wache getrennt.
 *
 * fail closed: unbekannte Rolle oder Aktion ergibt false — auch fuer
 * Zeichenketten, die der Typ nicht kennt (z. B. aus einer alten Sitzung).
 */
export const AKTIONEN = [
  // Erfassung (formular-actions.ts / stroeme-actions.ts)
  "strom.anlegen",
  "strom.bearbeiten",
  "strom.status_setzen",
  "strom.verwerfen",
  // Referenz- und Stammdaten (API-Routen)
  "akteur.anlegen",
  "materialart.anlegen",
  "region.anlegen",
  "projekt.starten",
  // Benutzerverwaltung (benutzer-actions.ts)
  "benutzer.anlegen",
  "benutzer.rolle_setzen",
  "benutzer.aktiv_setzen",
] as const;
export type Aktion = (typeof AKTIONEN)[number];

const ERFASSEN: readonly Rolle[] = ["bearbeiter", "admin"];
const VERWALTEN: readonly Rolle[] = ["admin"];

/** Wer darf was — je Aktion die Rollen, die sie ausloesen duerfen. */
export const MATRIX: Record<Aktion, readonly Rolle[]> = {
  "strom.anlegen": ERFASSEN,
  "strom.bearbeiten": ERFASSEN,
  "strom.status_setzen": ERFASSEN,
  "strom.verwerfen": ERFASSEN,
  "akteur.anlegen": ERFASSEN,
  "materialart.anlegen": ERFASSEN,
  "region.anlegen": ERFASSEN,
  "projekt.starten": ERFASSEN,
  "benutzer.anlegen": VERWALTEN,
  "benutzer.rolle_setzen": VERWALTEN,
  "benutzer.aktiv_setzen": VERWALTEN,
};

/** Nutzer aus Sicht der Matrix: ein Zugang oder nur die Rolle. */
export type Nutzer = Zugang | { rolle: string } | null | undefined;

export function istAktion(wert: string): wert is Aktion {
  return (AKTIONEN as readonly string[]).includes(wert);
}

/**
 * Reine Entscheidung: Darf dieser Nutzer diese Aktion? `objekt` ist fuer
 * objektbezogene Regeln vorgesehen (AP2.1 PR b: Sperren) und heute ohne
 * Wirkung. Serverseitig entscheidet ausschliesslich diese Funktion (ueber die
 * Wache); die Oberflaeche ruft sie nur zum Ausblenden auf.
 */
export function darf(nutzer: Nutzer, aktion: string, _objekt?: unknown): boolean {
  if (!nutzer) return false;
  if ("art" in nutzer && nutzer.art !== "erlaubt") return false;
  const rolle = nutzer.rolle;
  if (!(ROLLEN as readonly string[]).includes(rolle)) return false;
  if (!istAktion(aktion)) return false;
  return MATRIX[aktion].includes(rolle as Rolle);
}

/** Aktionen, die ausschliesslich Admins vorbehalten sind (fuer die Fehlermeldung). */
export function nurAdmin(aktion: Aktion): boolean {
  const erlaubt = MATRIX[aktion];
  return erlaubt.length === 1 && erlaubt[0] === "admin";
}
