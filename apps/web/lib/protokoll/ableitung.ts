/**
 * E23: Ersteller und Beteiligte werden aus dem Protokoll ABGELEITET, nie
 * gespeichert. Reine Funktionen ueber Protokollzeilen; die Abfrage dazu
 * steht in ./server.ts.
 */
import type { EreignisArt } from "./index";

export interface ProtokollZeile {
  art: EreignisArt;
  benutzerId: string | null;
  zeitpunkt: Date;
}

/**
 * Arten, die als Beteiligung an einem Strom zaehlen (Entscheidung Eric,
 * AP2.2; AP2.4 0.4: die strukturierten Statusarten zaehlen mit —
 * status_gesetzt bleibt fuer den Altbestand).
 */
export const BETEILIGUNGS_ARTEN: readonly EreignisArt[] = [
  "angelegt",
  "geaendert",
  "status_gesetzt",
  "verworfen",
  "in_pruefung_gegeben",
  "geprueft",
  "zurueckgegeben",
  "reaktiviert",
  "zurueckgesetzt",
];

export type Ersteller =
  | { art: "bekannt"; benutzerId: string }
  | { art: "unbekannt" };

/**
 * Ersteller = Urheber des Ereignisses „angelegt" (das frueheste, falls es
 * mehrere gaebe). Ohne ein solches Ereignis — Altbestand von vor 0026 oder
 * ein Objekt ohne Anlage-Ereignis — ist der Ersteller benannt unbekannt.
 */
export function erstellerAus(zeilen: readonly ProtokollZeile[]): Ersteller {
  const angelegt = zeilen
    .filter((z) => z.art === "angelegt" && z.benutzerId)
    .sort((a, b) => a.zeitpunkt.getTime() - b.zeitpunkt.getTime())[0];
  return angelegt ? { art: "bekannt", benutzerId: angelegt.benutzerId! } : { art: "unbekannt" };
}

/**
 * Beteiligte = alle Urheber der Beteiligungs-Arten, ohne Doppelte, in der
 * Reihenfolge des ersten Auftretens. Sperren und Zuweisen zaehlen nicht;
 * Altbestand traegt keine Art und faellt heraus.
 */
export function beteiligteAus(zeilen: readonly ProtokollZeile[]): string[] {
  const gesehen = new Set<string>();
  const ergebnis: string[] = [];
  for (const z of [...zeilen].sort((a, b) => a.zeitpunkt.getTime() - b.zeitpunkt.getTime())) {
    if (!z.benutzerId || !BETEILIGUNGS_ARTEN.includes(z.art) || gesehen.has(z.benutzerId)) continue;
    gesehen.add(z.benutzerId);
    ergebnis.push(z.benutzerId);
  }
  return ergebnis;
}
