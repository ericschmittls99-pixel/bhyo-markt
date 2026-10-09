/**
 * AP2.6 PR c (E71): Die @-Eingabe als reine Funktionen. Im Textfeld steht
 * ein lesbares Token „@Name" (nie die UUID), gespeichert wird der Marker
 * `@[nutzer:<uuid>]`. Die Zuordnung Token → Nutzer-ID haelt die Komponente,
 * solange das Feld offen ist; nur Tokens aus der Auswahl werden zu Markern —
 * ein von Hand getippter „@Name" bleibt Fliesstext (keine stille Erwaehnung).
 */
import { erwaehnungsMarker, type ErwaehnterNutzer } from "./kommentar-marker";

export interface Erwaehnbar {
  id: string;
  name: string | null;
  email: string;
}

export const VORSCHLAEGE_MAX = 6;

/** Anzeigename wie ueberall (Name, sonst E-Mail). */
export function anzeige(n: { name: string | null; email: string }): string {
  return (n.name ?? "").trim() || n.email;
}

/**
 * Token fuer einen Nutzer: „@Name"; traegt ein anderer Nutzer dasselbe Token
 * schon, wird die E-Mail angehaengt, damit die Zuordnung eindeutig bleibt.
 */
export function tokenFuer(n: Erwaehnbar, tokens: ReadonlyMap<string, string>): string {
  const einfach = `@${anzeige(n)}`;
  const belegt = tokens.get(einfach);
  return belegt && belegt !== n.id ? `@${anzeige(n)} (${n.email})` : einfach;
}

/** Zeichen, das ein Token beenden darf — Wortgrenze: nicht Buchstabe/Ziffer. */
const GRENZE = /[\p{L}\p{N}_]/u;

function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Tokens → Marker. Laengste Tokens zuerst, nur an Wortgrenzen (aus „@Otto Otherwise" wird nichts). */
export function tokensZuMarkern(text: string, tokens: ReadonlyMap<string, string>): string {
  let ergebnis = text;
  for (const [token, id] of [...tokens.entries()].sort((a, b) => b[0].length - a[0].length)) {
    const re = new RegExp(`${regexEscape(token)}(?![${GRENZE.source.slice(1, -1)}])`, "gu");
    ergebnis = ergebnis.replace(re, erwaehnungsMarker(id));
  }
  return ergebnis;
}

/**
 * Marker → Tokens (beim Oeffnen zum Bearbeiten). Deaktivierte oder unbekannte
 * Nutzer bleiben als Marker im Text stehen — sie sind nicht erwaehnbar, und so
 * bleibt beim Speichern die bestehende Erwaehnung erhalten statt stumm zu kippen.
 */
export function markerZuTokens(text: string, nutzer: ReadonlyMap<string, ErwaehnterNutzer>): { text: string; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  const ersetzt = text.replace(/@\[nutzer:([0-9a-fA-F-]{36})\]/g, (marker, roh: string) => {
    const id = roh.toLowerCase();
    const n = nutzer.get(id);
    if (!n || !n.aktiv) return marker;
    const token = tokenFuer({ id, name: n.name, email: n.email }, tokens);
    tokens.set(token, id);
    return token;
  });
  return { text: ersetzt, tokens };
}

/**
 * Laufende @-Abfrage vor dem Cursor: ein „@" am Wortanfang und dahinter der
 * getippte Teil (ohne Leerzeichen). null, wenn keine Abfrage offen ist.
 */
export function erwaehnungsAbfrage(text: string, cursor: number): { start: number; abfrage: string } | null {
  const davor = text.slice(0, cursor);
  const m = /(?:^|[\s(])@([^\s@]*)$/u.exec(davor);
  if (!m) return null;
  return { start: cursor - m[1]!.length - 1, abfrage: m[1]! };
}

/** Vorschlaege: Name oder E-Mail enthaelt die Abfrage (ohne Gross/Klein), hoechstens VORSCHLAEGE_MAX, Reihenfolge der Liste. */
export function vorschlaege(erwaehnbare: readonly Erwaehnbar[], abfrage: string, max = VORSCHLAEGE_MAX): Erwaehnbar[] {
  const q = abfrage.trim().toLocaleLowerCase("de-DE");
  return erwaehnbare.filter((n) => !q || anzeige(n).toLocaleLowerCase("de-DE").includes(q) || n.email.toLocaleLowerCase("de-DE").includes(q)).slice(0, max);
}

/** Ersetzt die offene Abfrage (ab `start` bis `cursor`) durch das Token plus Leerzeichen. */
export function fuegeTokenEin(text: string, start: number, cursor: number, token: string): { text: string; cursor: number } {
  const neu = `${text.slice(0, start)}${token} ${text.slice(cursor)}`;
  return { text: neu, cursor: start + token.length + 1 };
}
