/**
 * AP2.5 PR b (E66/E57/E47): Kontaktperson — reine Regeln. Jede Person gehoert zu
 * genau einem Akteur (kein Umhaengen); Laengengrenzen wie die CHECKs in
 * Migration 0036; am Notizfeld der Hinweis „Keine privaten oder sensiblen
 * Angaben". Namen stehen nie im Protokoll- oder Inbox-Freitext (E57) — sie
 * werden erst bei der Anzeige aus der Tabelle aufgeloest.
 */
export const KONTAKT_GRENZEN = { name: 200, funktion: 120, mailDienstlich: 200, telefon: 60, notiz: 1000 } as const;
export const NOTIZ_HINWEIS = "Keine privaten oder sensiblen Angaben.";

export interface KontaktpersonEingabe {
  name: string;
  funktion: string | null;
  mailDienstlich: string | null;
  telefon: string | null;
  notiz: string | null;
}

export interface Kontaktperson extends KontaktpersonEingabe {
  id: string;
  akteurId: string;
  erstelltAm: string;
  geaendertAm: string;
  /** JJJJ-MM-TT der letzten Aktivitaet (Person oder Beleg ihres Akteurs) — fuer die Loeschpruefung (E57). */
  letzteAktivitaet: string | null;
}

export type KontaktpersonPruefung = { ok: true; w: KontaktpersonEingabe } | { ok: false; fehler: string };

function feld(src: FormData | Record<string, unknown>, k: string): string {
  const v = src instanceof FormData ? src.get(k) : src[k];
  return typeof v === "string" ? v.trim() : "";
}

export function pruefeKontaktpersonEingabe(src: FormData | Record<string, unknown>): KontaktpersonPruefung {
  const name = feld(src, "name");
  if (!name) return { ok: false, fehler: "Name ist Pflicht." };
  if (name.length > KONTAKT_GRENZEN.name) return { ok: false, fehler: `Der Name darf höchstens ${KONTAKT_GRENZEN.name} Zeichen haben.` };
  const w: KontaktpersonEingabe = {
    name,
    funktion: feld(src, "funktion") || null,
    mailDienstlich: feld(src, "mail_dienstlich") || null,
    telefon: feld(src, "telefon") || null,
    notiz: feld(src, "notiz") || null,
  };
  for (const [k, grenze] of [["funktion", KONTAKT_GRENZEN.funktion], ["mailDienstlich", KONTAKT_GRENZEN.mailDienstlich], ["telefon", KONTAKT_GRENZEN.telefon], ["notiz", KONTAKT_GRENZEN.notiz]] as const) {
    const v = w[k];
    if (v && v.length > grenze) return { ok: false, fehler: `Das Feld ${k === "mailDienstlich" ? "E-Mail (dienstlich)" : k} darf höchstens ${grenze} Zeichen haben.` };
  }
  if (w.mailDienstlich && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(w.mailDienstlich)) return { ok: false, fehler: "Die dienstliche E-Mail-Adresse ist ungültig." };
  return { ok: true, w };
}

/** Welche Felder sich geaendert haben — nur die Namen der Felder, nie Werte (E57). */
export function geaenderteFelder(alt: KontaktpersonEingabe, neu: KontaktpersonEingabe): string[] {
  return (Object.keys(neu) as (keyof KontaktpersonEingabe)[]).filter((k) => (alt[k] ?? null) !== (neu[k] ?? null));
}
