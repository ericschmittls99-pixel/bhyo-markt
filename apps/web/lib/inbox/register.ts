/**
 * AP2.2: Das Register der Inbox-Typen — je Typ Text, Empfaengerregel,
 * Buendelungsschluessel und erlaubte Aktionen an EINER Stelle. Ein neuer Typ
 * kommt hier dazu, nicht verstreut in Aktionen und Oberflaeche.
 */
import type { inboxTyp } from "@bhyo/db/schema";

import type { EreignisArt } from "@/lib/protokoll";

export type InboxTyp = (typeof inboxTyp.enumValues)[number];

export type InboxAktion =
  | "inbox.gelesen"
  | "inbox.ungelesen"
  | "inbox.erledigen"
  | "inbox.verwerfen"
  | "inbox.alle_erledigen"
  | "inbox.ablehnen"
  | "strom.zuweisen";

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

function objektText(z: ZeilenDaten): string {
  return [z.belegNr, z.bezeichnung].filter(Boolean).join(" ") || "einen Eintrag";
}

/**
 * Reihenfolge = Zustellreihenfolge je Ereignis (AP2.4, D6): erst die Aufgaben-
 * und Rueckmeldetypen, dann der Hinweis „Aenderung an meinem Eintrag" — wer
 * fuer dasselbe Ereignis schon einen pruefauftrag oder pruefung_erledigt
 * bekommt, bekommt keinen aenderung_eintrag mehr (zustellung.ts).
 */
export const INBOX_TYPEN: Record<InboxTyp, TypDefinition> = {
  // AP2.4 PR a (E62)
  pruefauftrag: {
    arten: ["in_pruefung_gegeben", "zurueckgesetzt"],
    empfaengerregel: "alle aktiven Pruefer und Admins ausser dem Ausloeser",
    buendelung: "je Pruefer und Strom, solange der Auftrag offen ist; erledigt bei allen, sobald jemand prueft, zurueckgibt oder verwirft",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen"],
    reinerHinweis: false,
    text: (z) => `${z.ausloeserName} bittet um Prüfung von ${objektText(z)}${z.anzahl > 1 ? ` (${z.anzahl}. Mal)` : ""}`,
  },
  pruefung_erledigt: {
    arten: ["geprueft"],
    empfaengerregel:
      "die Person, die zuletzt in Pruefung gegeben oder die Ruecksetzung ausgeloest hat — nie der Pruefer selbst",
    buendelung: "keine — jede Pruefung ein Eintrag",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.alle_erledigen"],
    reinerHinweis: true,
    text: (z) => `${z.ausloeserName} hat ${objektText(z)} geprüft`,
  },
  aenderung_eintrag: {
    arten: ["geaendert", "status_gesetzt", "verworfen", "in_pruefung_gegeben", "geprueft", "zurueckgegeben", "reaktiviert", "zurueckgesetzt"],
    empfaengerregel:
      "alle Beteiligten des Stroms (Beteiligungs-Arten, lib/protokoll/ableitung.ts) ausser dem Ausloeser, Deaktivierten, Betrachtern — und ausser denen, die fuer dasselbe Ereignis schon pruefauftrag oder pruefung_erledigt bekommen",
    buendelung: "je Empfaenger und Strom, solange der Eintrag offen ist",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.alle_erledigen"],
    reinerHinweis: true,
    text: (z) => `${z.ausloeserName} hat ${objektText(z)} geändert${z.anzahl > 1 ? ` (${z.anzahl} Änderungen)` : ""}`,
  },
  // PR c
  zugriffsanfrage: {
    arten: ["zugriff_angefragt"],
    empfaengerregel:
      "der Sperrinhaber; ist er kein Pruefer mehr oder deaktiviert, alle aktiven Admins",
    buendelung: "je Empfaenger, Strom und Anfragendem, solange offen (zwei Anfragende = zwei Eintraege)",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "strom.zuweisen", "inbox.ablehnen"],
    reinerHinweis: false,
    text: (z) => `${z.ausloeserName} bittet um Zugriff auf ${objektText(z)}${z.anzahl > 1 ? ` (${z.anzahl}. Anfrage)` : ""}`,
  },
  freischaltung: {
    arten: ["zugewiesen"],
    empfaengerregel: "die zugewiesene Person",
    buendelung: "keine — jede Zuweisung ein Eintrag",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.alle_erledigen"],
    reinerHinweis: true,
    text: (z) => `${z.ausloeserName} hat dir Zugriff auf ${objektText(z)} gegeben`,
  },
  zugriff_abgelehnt: {
    arten: ["zugriff_abgelehnt"],
    empfaengerregel: "die anfragende Person",
    buendelung: "keine — jede Ablehnung ein Eintrag",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.alle_erledigen"],
    reinerHinweis: true,
    text: (z) => `${z.ausloeserName} hat deine Zugriffsanfrage zu ${objektText(z)} abgelehnt`,
  },
};

/** Welche Typen entstehen aus einer Ereignisart, in Zustellreihenfolge? Leer = keine Zustellung. */
export function typenFuerArt(art: EreignisArt): InboxTyp[] {
  return (Object.entries(INBOX_TYPEN) as [InboxTyp, TypDefinition][]).filter(([, def]) => def.arten.includes(art)).map(([typ]) => typ);
}

/** Der erste Typ einer Ereignisart (Aufgabe vor Hinweis); null = keine Zustellung. */
export function typFuerArt(art: EreignisArt): InboxTyp | null {
  return typenFuerArt(art)[0] ?? null;
}
