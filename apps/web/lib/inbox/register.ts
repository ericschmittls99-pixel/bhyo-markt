/**
 * AP2.2 PR b: Das Register der Inbox-Typen — je Typ Text, Empfaengerregel,
 * Buendelungsschluessel und erlaubte Aktionen an EINER Stelle. Ein neuer Typ
 * (PR c: zugriffsanfrage, freischaltung, zugriff_abgelehnt) kommt hier dazu,
 * nicht verstreut in Aktionen und Oberflaeche.
 */
import type { inboxTyp } from "@bhyo/db/schema";

import type { EreignisArt } from "@/lib/protokoll";

export type InboxTyp = (typeof inboxTyp.enumValues)[number];

export type InboxAktion =
  | "inbox.gelesen"
  | "inbox.ungelesen"
  | "inbox.erledigen"
  | "inbox.verwerfen"
  | "inbox.alle_erledigen";

/** Was die Zeile anzeigt — aus dem Eintrag und seinem Strom abgeleitet, nie gespeichert. */
export interface ZeilenDaten {
  ausloeserName: string;
  belegNr: string | null;
  bezeichnung: string | null;
  anzahl: number;
}

export interface TypDefinition {
  /** Ereignisarten, die diesen Typ ausloesen. */
  arten: readonly EreignisArt[];
  /** Empfaengerregel in Worten (die Abfrage steht in zustellung.ts). */
  empfaengerregel: string;
  /** Buendelungsschluessel in Worten (die Indizes stehen in packages/db/src/schema.ts). */
  buendelung: string;
  /** Aktionen, die am Eintrag erlaubt sind. */
  aktionen: readonly InboxAktion[];
  /** „Alle erledigt" gilt fuer reine Hinweise. */
  reinerHinweis: boolean;
  text: (z: ZeilenDaten) => string;
}

export const INBOX_TYPEN: Record<InboxTyp, TypDefinition> = {
  aenderung_eintrag: {
    arten: ["geaendert", "status_gesetzt", "verworfen"],
    empfaengerregel:
      "alle Beteiligten des Stroms (angelegt, geaendert, status_gesetzt, verworfen) ausser dem Ausloeser, Deaktivierten und Betrachtern",
    buendelung: "je Empfaenger und Strom, solange der Eintrag offen ist",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.alle_erledigen"],
    reinerHinweis: true,
    text: (z) => {
      const objekt = [z.belegNr, z.bezeichnung].filter(Boolean).join(" ") || "einen Eintrag";
      const zusatz = z.anzahl > 1 ? ` (${z.anzahl} Änderungen)` : "";
      return `${z.ausloeserName} hat ${objekt} geändert${zusatz}`;
    },
  },
};

/** Welcher Typ entsteht aus einer Ereignisart? null = keine Zustellung. */
export function typFuerArt(art: EreignisArt): InboxTyp | null {
  for (const [typ, def] of Object.entries(INBOX_TYPEN) as [InboxTyp, TypDefinition][]) {
    if (def.arten.includes(art)) return typ;
  }
  return null;
}
