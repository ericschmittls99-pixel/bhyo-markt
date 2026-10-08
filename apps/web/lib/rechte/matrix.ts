import { ROLLEN, type Rolle, type Zugang } from "./rollen";

/**
 * E42 (AP2.1): DIE Rechte-Matrix — eine Stelle, Daten statt verstreuter
 * Bedingungen. Eine Aktion steht hier erst, wenn es ihren Schreibpfad gibt
 * (Leitregel AP2); eine Rolle kommt erst mit ihrer ersten Wirkung.
 * Hierarchie admin ⊇ pruefer ⊇ bearbeiter ⊇ betrachter ist ausgeschrieben,
 * nicht als Rang gerechnet — was eine Rolle darf, liest man ab. Lesen ist
 * keine Aktion dieser Matrix: Wer einen Zugang hat (angemeldet, eingetragen,
 * aktiv), liest; das prueft die Wache getrennt.
 *
 * E44: Sperren am Strom sind OBJEKTBEZOGENE Regeln derselben Matrix
 * (`OBJEKT_REGELN`), nicht verstreute Bedingungen in den Actions.
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
  // Sperren und Zuweisung (sperre-actions.ts, E44)
  "strom.sperren",
  "strom.entsperren",
  "strom.zuweisen",
  "strom.zuweisung_entfernen",
  // Zugriffsanfrage am gesperrten Strom (PR c)
  "strom.zugriff_anfragen",
  // Referenz- und Stammdaten (API-Routen)
  "akteur.anlegen",
  "region.anlegen",
  "projekt.starten",
  // Benutzerverwaltung (benutzer-actions.ts)
  "benutzer.anlegen",
  "benutzer.rolle_setzen",
  "benutzer.aktiv_setzen",
  // Inbox (lib/inbox/actions.ts, AP2.2): nur der Empfaenger, Objektregel
  "inbox.gelesen",
  "inbox.ungelesen",
  "inbox.erledigen",
  "inbox.verwerfen",
  "inbox.alle_erledigen",
  "inbox.ablehnen",
  // Parameter mit Verlauf (parameter-actions.ts, AP2.3 PR a / E60): nur admin
  "parameter.setzen",
  "parameter.zuruecknehmen",
  // Sektorliste (sektor-actions.ts, AP2.3 PR b / E59): nur admin; nie loeschen
  "sektor.anlegen",
  "sektor.umbenennen",
  "sektor.deaktivieren",
  "sektor.reaktivieren",
  // AP2.4 PR a (E62, D4): „geprueft" nur pruefer/admin (strom.pruefen, auch
  // direkt aus entwurf); Ablauf-Markierung des Belegs nur pruefer/admin.
  // Objektregel wie beim Bearbeiten: am gesperrten Strom nur Inhaber,
  // Zugewiesene und admin.
  "strom.pruefen",
  "beleg.abgelaufen_markieren",
  "beleg.abgelaufen_aufheben",
  // AP2.4 PR b (E63): erneut verifizieren — pruefer/admin, Objektregel wie das Bearbeiten.
  "strom.reverifizieren",
  // AP2.4 PR c (E63, D5): weitergeben — ab bearbeiter, nur eigene Eintraege (nurEmpfaenger).
  "inbox.weitergeben",
  // AP2.5 PR a1 (E66): Stammdaten ab bearbeiter ohne Sperre; loeschen nur admin
  // und nur verwaist (Server prueft, die DB weist per FK jeden Strom-Bezug ab).
  "akteur.bearbeiten",
  "akteur.loeschen",
  // AP2.5 PR b (E66): Kontaktpersonen — lesen alle mit Zugang; anlegen/bearbeiten
  // ab bearbeiter; loeschen pruefer/admin; Auskunfts-Export (Art. 15) nur admin.
  "kontaktperson.anlegen",
  "kontaktperson.bearbeiten",
  "kontaktperson.loeschen",
  "kontaktperson.auskunft",
  // AP2.5 PR c (E66): „keine Dublette" markieren und aufheben nur pruefer/admin
  // (Entscheidung Eric 01.10.2026); zusammenfuehren nur pruefer/admin,
  // endgueltig — Sperren der betroffenen Stroeme prueft die Action je Strom
  // mit der Objektregel von strom.bearbeiten.
  "akteur.keine_dublette",
  "akteur.keine_dublette_aufheben",
  "akteur.zusammenfuehren",
  // AP2.7 PR a (E67): Import nur Pruefer und Admin; Zuruecknehmen (PR d) nur Admin.
  "import.ausfuehren",
  "import.zuruecknehmen",
  // AP2.7 PR g (Eric 07.10.2026): einen nie ausgefuehrten Lauf verwerfen — Ersteller,
  // Pruefer, Admin; Ersteller sind immer Pruefer oder Admin (import.ausfuehren).
  "import.verwerfen",
  // AP2.6 PR a (E71): Kommentare — ab bearbeiter; bearbeiten nur der Autor,
  // loeschen Autor oder admin (Objektregel). Betrachter lesen nur.
  "kommentar.erstellen",
  "kommentar.bearbeiten",
  "kommentar.loeschen",
] as const;
export type Aktion = (typeof AKTIONEN)[number];

const ERFASSEN: readonly Rolle[] = ["bearbeiter", "pruefer", "admin"];
const SPERREN: readonly Rolle[] = ["pruefer", "admin"];
const VERWALTEN: readonly Rolle[] = ["admin"];
/** Jede Rolle mit Zugang — die Inbox gehoert der Person, nicht der Rolle. */
const ALLE: readonly Rolle[] = ROLLEN;

/** Wer darf was — je Aktion die Rollen, die sie ausloesen duerfen (Rollenstufe). */
export const MATRIX: Record<Aktion, readonly Rolle[]> = {
  "strom.anlegen": ERFASSEN,
  "strom.bearbeiten": ERFASSEN,
  "strom.status_setzen": ERFASSEN,
  "strom.verwerfen": ERFASSEN,
  "strom.sperren": SPERREN,
  "strom.entsperren": SPERREN,
  "strom.zuweisen": SPERREN,
  "strom.zuweisung_entfernen": SPERREN,
  "strom.zugriff_anfragen": ERFASSEN,
  "akteur.anlegen": ERFASSEN,
  "region.anlegen": ERFASSEN,
  "projekt.starten": ERFASSEN,
  "benutzer.anlegen": VERWALTEN,
  "benutzer.rolle_setzen": VERWALTEN,
  "benutzer.aktiv_setzen": VERWALTEN,
  "inbox.gelesen": ALLE,
  "inbox.ungelesen": ALLE,
  "inbox.erledigen": ALLE,
  "inbox.verwerfen": ALLE,
  "inbox.alle_erledigen": ALLE,
  "inbox.ablehnen": ALLE,
  "parameter.setzen": VERWALTEN,
  "parameter.zuruecknehmen": VERWALTEN,
  "sektor.anlegen": VERWALTEN,
  "sektor.umbenennen": VERWALTEN,
  "sektor.deaktivieren": VERWALTEN,
  "sektor.reaktivieren": VERWALTEN,
  "strom.pruefen": SPERREN,
  "beleg.abgelaufen_markieren": SPERREN,
  "beleg.abgelaufen_aufheben": SPERREN,
  "strom.reverifizieren": SPERREN,
  "inbox.weitergeben": ERFASSEN,
  "akteur.bearbeiten": ERFASSEN,
  "akteur.loeschen": VERWALTEN,
  "kontaktperson.anlegen": ERFASSEN,
  "kontaktperson.bearbeiten": ERFASSEN,
  "kontaktperson.loeschen": SPERREN,
  "kontaktperson.auskunft": VERWALTEN,
  "akteur.keine_dublette": SPERREN,
  "akteur.keine_dublette_aufheben": SPERREN,
  "akteur.zusammenfuehren": SPERREN,
  "import.ausfuehren": SPERREN,
  "import.zuruecknehmen": VERWALTEN,
  "import.verwerfen": SPERREN,
  "kommentar.erstellen": ERFASSEN,
  "kommentar.bearbeiten": ERFASSEN,
  "kommentar.loeschen": ERFASSEN,
};

/** Nutzer aus Sicht der Matrix: ein Zugang oder Rolle (+ ID fuer Objektregeln). */
export type Nutzer = Zugang | { rolle: string; id?: string } | null | undefined;

/**
 * E44: Sperrzustand eines Stroms, wie ihn die Objektregeln brauchen —
 * Inhaber (benutzer.id) und Zugewiesene (benutzer.id). Nicht gesperrt:
 * `gesperrtVon: null`.
 */
export interface StromSperre {
  gesperrtVon: string | null;
  zugewiesene: readonly string[];
}

/** AP2.2: Objekt der Inbox-Regeln — der Empfaenger des Eintrags. */
export interface InboxObjekt {
  empfaengerId: string;
}

/** AP2.6 PR a (E71): Objekt der Kommentar-Regeln — der Autor (benutzer.id). */
export interface KommentarObjekt {
  autorId: string;
}

/** Alles, woran eine Objektregel entscheidet. */
export type Objekt = StromSperre | InboxObjekt | KommentarObjekt;
const istSperre = (o: Objekt): o is StromSperre => "gesperrtVon" in o;
const istInbox = (o: Objekt): o is InboxObjekt => "empfaengerId" in o;
const istKommentar = (o: Objekt): o is KommentarObjekt => "autorId" in o;

export function istAktion(wert: string): wert is Aktion {
  return (AKTIONEN as readonly string[]).includes(wert);
}

type Objektregel = (nutzer: { id: string | undefined; rolle: Rolle }, objekt: Objekt) => boolean;

/** Gesperrt: nur Inhaber, Zugewiesene und admin duerfen den Strom fachlich aendern (E44). */
const aendernBeiSperre: Objektregel = (n, o) =>
  istSperre(o) &&
  (o.gesperrtVon == null || n.rolle === "admin" || (!!n.id && (n.id === o.gesperrtVon || o.zugewiesene.includes(n.id))));
/** Sperren: nur auf ungesperrten Stroemen. */
const sperren: Objektregel = (_n, o) => istSperre(o) && o.gesperrtVon == null;
/** Entsperren / zuweisen / Zuweisung entfernen: der Sperrinhaber, solange er pruefer ist, oder admin. */
const inhaberOderAdmin: Objektregel = (n, o) =>
  istSperre(o) &&
  o.gesperrtVon != null &&
  (n.rolle === "admin" || (n.rolle === "pruefer" && !!n.id && n.id === o.gesperrtVon));
/** PR c: Zugriff anfragen — nur am gesperrten Strom, und nur wer weder Inhaber noch zugewiesen ist. */
const zugriffAnfragen: Objektregel = (n, o) =>
  istSperre(o) && o.gesperrtVon != null && !!n.id && n.id !== o.gesperrtVon && !o.zugewiesene.includes(n.id);
/** AP2.2: Inbox-Eintraege liest und aendert nur der Empfaenger — auch admin nicht fremde. */
const nurEmpfaenger: Objektregel = (n, o) => istInbox(o) && !!n.id && n.id === o.empfaengerId;
/**
 * AP2.6 PR a (E71): eigene Kommentare bearbeitet nur der Autor — auch admin
 * nicht fremde; loeschen (weich) darf der Autor oder admin. Die Sperre des
 * Stroms spielt keine Rolle: ein Kommentar aendert keine Stromdaten (E44
 * nennt nur die fachlichen Schreibpfade).
 */
const nurAutor: Objektregel = (n, o) => istKommentar(o) && !!n.id && n.id === o.autorId;
const autorOderAdmin: Objektregel = (n, o) => istKommentar(o) && (n.rolle === "admin" || (!!n.id && n.id === o.autorId));

/**
 * Objektbezogene Regeln (E44) — gelten ZUSAETZLICH zur Rollenstufe. Wo eine
 * Aktion hier steht, ist ohne Objekt keine Entscheidung moeglich: darf()
 * ergibt dann false (fail closed), damit kein Schreibpfad die Sperre
 * vergisst.
 */
const OBJEKT_REGELN: Partial<Record<Aktion, Objektregel>> = {
  "strom.bearbeiten": aendernBeiSperre,
  "strom.status_setzen": aendernBeiSperre,
  "strom.verwerfen": aendernBeiSperre,
  "strom.pruefen": aendernBeiSperre,
  "beleg.abgelaufen_markieren": aendernBeiSperre,
  "beleg.abgelaufen_aufheben": aendernBeiSperre,
  "strom.reverifizieren": aendernBeiSperre,
  "strom.sperren": sperren,
  "strom.entsperren": inhaberOderAdmin,
  "strom.zuweisen": inhaberOderAdmin,
  "strom.zuweisung_entfernen": inhaberOderAdmin,
  "strom.zugriff_anfragen": zugriffAnfragen,
  "inbox.gelesen": nurEmpfaenger,
  "inbox.ungelesen": nurEmpfaenger,
  "inbox.erledigen": nurEmpfaenger,
  "inbox.verwerfen": nurEmpfaenger,
  "inbox.ablehnen": nurEmpfaenger,
  "inbox.weitergeben": nurEmpfaenger,
  "kommentar.bearbeiten": nurAutor,
  "kommentar.loeschen": autorOderAdmin,
};

/** Aktionen, die ein Objekt verlangen (fuer Aufrufer, Wächter und Tests). */
export function brauchtObjekt(aktion: Aktion): boolean {
  return aktion in OBJEKT_REGELN;
}
export const OBJEKT_AKTIONEN: readonly Aktion[] = AKTIONEN.filter((a) => a in OBJEKT_REGELN);

/**
 * Rollenstufe allein (Eingang der Wache): reicht die Rolle fuer die Aktion?
 * Die Objektregel (Sperre) prueft der Schreibpfad danach IN der Transaktion
 * mit `darf(nutzer, aktion, objekt)` — scripts/rechte-check.ts verlangt
 * diesen zweiten Aufruf fuer jede Aktion mit Objektregel.
 */
export function darfRolle(nutzer: Nutzer, aktion: string): boolean {
  if (!nutzer) return false;
  if ("art" in nutzer && nutzer.art !== "erlaubt") return false;
  if (!(ROLLEN as readonly string[]).includes(nutzer.rolle)) return false;
  if (!istAktion(aktion)) return false;
  return MATRIX[aktion].includes(nutzer.rolle as Rolle);
}

/**
 * Reine Entscheidung: Darf dieser Nutzer diese Aktion (an diesem Objekt)?
 * Serverseitig entscheidet ausschliesslich diese Funktion (ueber die Wache);
 * die Oberflaeche ruft sie nur zum Ausblenden auf. Ohne Objekt entscheidet
 * die Rollenstufe — ausser die Aktion hat eine Objektregel: dann false.
 */
export function darf(nutzer: Nutzer, aktion: string, objekt?: Objekt | null): boolean {
  if (!nutzer) return false;
  if ("art" in nutzer && nutzer.art !== "erlaubt") return false;
  const rolle = nutzer.rolle;
  if (!(ROLLEN as readonly string[]).includes(rolle)) return false;
  if (!istAktion(aktion)) return false;
  if (!MATRIX[aktion].includes(rolle as Rolle)) return false;
  const regel = OBJEKT_REGELN[aktion];
  if (!regel) return true;
  if (!objekt) return false;
  return regel({ id: nutzer.id, rolle: rolle as Rolle }, objekt);
}

/** Aktionen, die ausschliesslich Admins vorbehalten sind (fuer die Fehlermeldung). */
export function nurAdmin(aktion: Aktion): boolean {
  const erlaubt = MATRIX[aktion];
  return erlaubt.length === 1 && erlaubt[0] === "admin";
}

/** E44: Zuweisen nur an Nutzer mit Rolle >= bearbeiter, die aktiv sind. */
export function darfZugewiesenWerden(ziel: { rolle: string; aktiv: boolean } | null | undefined): boolean {
  if (!ziel || !ziel.aktiv) return false;
  return ERFASSEN.includes(ziel.rolle as Rolle);
}
