/**
 * AP2.2: Das Register der Inbox-Typen — je Typ Text, Empfaengerregel,
 * Buendelungsschluessel und erlaubte Aktionen an EINER Stelle. Ein neuer Typ
 * kommt hier dazu, nicht verstreut in Aktionen und Oberflaeche.
 */
import type { inboxTyp } from "@bhyo/db/schema";

import { fmtDatum } from "@/lib/format";
import type { EreignisArt } from "@/lib/protokoll";

export type InboxTyp = (typeof inboxTyp.enumValues)[number];

export type InboxAktion =
  | "inbox.gelesen"
  | "inbox.ungelesen"
  | "inbox.erledigen"
  | "inbox.verwerfen"
  | "inbox.alle_erledigen"
  | "inbox.ablehnen"
  | "strom.zuweisen"
  /** PR b: erneut verifizieren am Hinweis (nur Pruefer, dieselbe Aktion wie im Beleg-Kopf). */
  | "strom.reverifizieren"
  /** PR c (D5): weitergeben als Aufgabe an eine Person (ab bearbeiter, nie an sich selbst). */
  | "inbox.weitergeben";

/** Was die Zeile anzeigt — aus dem Eintrag und seinem Strom abgeleitet, nie gespeichert. */
export interface ZeilenDaten {
  /** Leer bei den Hinweisen des Jobs (kein Urheber). */
  ausloeserName: string;
  belegNr: string | null;
  bezeichnung: string | null;
  anzahl: number;
  /** PR b: Bezugsdatum des Job-Hinweises (verifiziert_bis, JJJJ-MM-TT); null bei Pruefdatum unbekannt. */
  bezugsdatum?: string | null;
  /** PR c: Aufgabentext beim Typ aufgabe. */
  aufgabe?: string | null;
  /** AP2.5: Name des Akteurs beim Typ akteur_verwaist (Objektbezug Akteur statt Strom). */
  akteurName?: string | null;
}

export interface TypDefinition {
  /** Ereignisarten, die diesen Typ ausloesen. */
  arten: readonly EreignisArt[]; // leer = nicht ereignisgetrieben (Job-Hinweise, lib/inbox/hinweise.ts)
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
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.weitergeben"],
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
  // AP2.5 PR a1 (E66): verwaister Akteur (kein Strom) seit N Monaten — Hinweis
  // des taeglichen Jobs an alle aktiven Admins, kein Ereignis, kein Urheber.
  akteur_verwaist: {
    arten: [],
    empfaengerregel: "alle aktiven Admins",
    buendelung: "je Admin, Akteur und Bezugsdatum (seit wann verwaist) genau ein Eintrag, dauerhaft; erledigt, sobald der Akteur wieder einen Strom hat",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "inbox.alle_erledigen"],
    reinerHinweis: true,
    text: (z) => `Akteur ${z.akteurName ?? "–"} ist seit ${z.bezugsdatum ? fmtDatum(z.bezugsdatum) : "–"} verwaist – kein Strom verweist auf ihn`,
  },
  // AP2.4 PR b (E63): zustandsbasierte Hinweise des taeglichen Jobs — kein
  // Ereignis, kein Urheber; Empfaenger und Idempotenz in lib/inbox/hinweise.ts.
  // AP2.4 PR c (E63, D5): Aufgabe aus Weitergeben — an die genannte Person, mit Text.
  aufgabe: {
    arten: ["weitergegeben"],
    empfaengerregel: "die Person, an die weitergegeben wurde (betrifftId) — aktiv, Rolle >= bearbeiter, nie der Weitergebende selbst",
    buendelung: "keine — jede Weitergabe ein Eintrag mit eigenem Text; erledigt, sobald der Strom geprueft/reverifiziert/verworfen ist oder der Empfaenger erledigt",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen"],
    reinerHinweis: false,
    text: (z) => `${z.ausloeserName} bittet dich zu ${objektText(z)}: „${z.aufgabe ?? ""}"`,
  },
  verifikation_laeuft_ab: {
    arten: [],
    empfaengerregel:
      "der Pruefer des letzten Ereignisses geprueft/reverifiziert; ist er kein Pruefer/Admin mehr oder deaktiviert, alle aktiven Pruefer und Admins",
    buendelung: "je Empfaenger, Strom und Bezugsdatum (verifiziert_bis) genau ein Eintrag, dauerhaft — ein zweiter Lauf erzeugt nichts",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "strom.reverifizieren", "inbox.weitergeben"],
    reinerHinweis: false,
    text: (z) => `Verifikation von ${objektText(z)} läuft am ${z.bezugsdatum ? fmtDatum(z.bezugsdatum) : "–"} ab`,
  },
  verifikation_abgelaufen: {
    arten: [],
    empfaengerregel:
      "wie verifikation_laeuft_ab; bei Pruefdatum unbekannt alle aktiven Pruefer und Admins",
    buendelung: "wie verifikation_laeuft_ab; Pruefdatum unbekannt ohne Bezugsdatum, einmal je Empfaenger und Strom",
    aktionen: ["inbox.gelesen", "inbox.ungelesen", "inbox.erledigen", "inbox.verwerfen", "strom.reverifizieren", "inbox.weitergeben"],
    reinerHinweis: false,
    text: (z) =>
      z.bezugsdatum
        ? `Verifikation von ${objektText(z)} ist seit ${fmtDatum(z.bezugsdatum)} abgelaufen`
        : `Prüfdatum von ${objektText(z)} unbekannt – bitte verifizieren`,
  },
  aenderung_eintrag: {
    arten: ["geaendert", "status_gesetzt", "verworfen", "in_pruefung_gegeben", "geprueft", "zurueckgegeben", "reaktiviert", "zurueckgesetzt", "reverifiziert"],
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

/**
 * Zeilentext zu einem Typ. Kennt dieser Stand den Typ nicht (geteilte
 * Preview, Datenbank mit spaeterer Migration — z. B. Hinweise von AP2.5),
 * bleibt die Zeile sichtbar mit einem benannten Platzhalter statt die ganze
 * Inbox abstuerzen zu lassen (Befund 04.10.2026).
 */
export function zeilenText(typ: string, z: ZeilenDaten): string {
  const def = (INBOX_TYPEN as Record<string, TypDefinition | undefined>)[typ];
  return def ? def.text(z) : `Hinweis eines neueren Stands (${typ}) — ${z.bezeichnung ?? z.belegNr ?? "ohne Objekt"}`;
}

/** Welche Typen entstehen aus einer Ereignisart, in Zustellreihenfolge? Leer = keine Zustellung. */
export function typenFuerArt(art: EreignisArt): InboxTyp[] {
  return (Object.entries(INBOX_TYPEN) as [InboxTyp, TypDefinition][]).filter(([, def]) => def.arten.includes(art)).map(([typ]) => typ);
}

/** Der erste Typ einer Ereignisart (Aufgabe vor Hinweis); null = keine Zustellung. */
export function typFuerArt(art: EreignisArt): InboxTyp | null {
  return typenFuerArt(art)[0] ?? null;
}
