/**
 * AP2.5 PR a1 (E66): das Akteur-Modell fuer akteure. — Zustaende abgeleitet,
 * nie gespeichert (E23), benannt (E24):
 *   unvollstaendig  = Sitz ohne Adresse (keine Strasse) — E66: „Unvollständig heißt: keine Adresse"
 *   ohne_beleg      = Stroeme vorhanden, aber keiner mit Beleg
 *   verwaist        = kein Strom verweist auf den Akteur (E48)
 * Filter und Facetten gehen durch das Filtermodell (E32, Ansicht „akteure").
 */
import { OHNE_SEKTOR } from "./hierarchie-baeume";

export type AkteurZustand = "unvollstaendig" | "ohne_beleg" | "verwaist";

export const AKTEUR_ZUSTAENDE: readonly AkteurZustand[] = ["unvollstaendig", "ohne_beleg", "verwaist"];

export const AKTEUR_ZUSTAND_LABEL: Record<AkteurZustand, string> = {
  unvollstaendig: "unvollständig",
  ohne_beleg: "ohne Beleg",
  verwaist: "verwaist",
};

export interface AkteurZeile {
  id: string;
  name: string;
  sektor: string;
  sektorLabel: string;
  sitzStrasse: string | null;
  sitzHausnummer: string | null;
  sitzPlz: string | null;
  sitzOrt: string | null;
  sitzLng: number | null;
  sitzLat: number | null;
  kreisArs: string | null;
  kreisName: string | null;
  /** Regionen, deren Gebiet den Sitz enthaelt (ST_Contains, wie beim Strom-Standort). */
  regionIds: string[];
  stroeme: number;
  mitBeleg: number;
  /** JJJJ-MM-TT, seit wann der Akteur verwaist ist (Protokoll, sonst Anlage); null wenn nicht verwaist. */
  verwaistSeit: string | null;
  erstelltAm: string;
}

export function zustaendeAus(a: AkteurZeile): AkteurZustand[] {
  const z: AkteurZustand[] = [];
  if (!a.sitzStrasse) z.push("unvollstaendig");
  if (a.stroeme > 0 && a.mitBeleg === 0) z.push("ohne_beleg");
  if (a.stroeme === 0) z.push("verwaist");
  return z;
}

export interface AkteureFilter {
  q: string;
  /** „Sitz in Region" — die Region, die den Sitz enthaelt. */
  region: string[];
  sektor: string[];
  akteur: string[];
  akteur_zustand: string[];
}

export const LEERER_AKTEURE_FILTER: AkteureFilter = { q: "", region: [], sektor: [], akteur: [], akteur_zustand: [] };

/** Welche Schluessel des Filtermodells diese Funktion anwendet (Waechter in filter-modell.test.ts). */
export const ANGEWANDTE_AKTEUR_SCHLUESSEL: readonly string[] = ["region", "akteur", "akteur_zustand"];

export function filterAkteure(pool: AkteurZeile[], f: AkteureFilter): AkteurZeile[] {
  const q = f.q.trim().toLowerCase();
  return pool.filter((a) => {
    if (q && !`${a.name} ${a.sitzOrt ?? ""} ${a.sitzPlz ?? ""}`.toLowerCase().includes(q)) return false;
    if (f.region.length && !a.regionIds.some((r) => f.region.includes(r))) return false;
    if (f.sektor.length && !f.sektor.includes(a.sektor || OHNE_SEKTOR)) return false;
    if (f.akteur.length && !f.akteur.includes(a.id)) return false;
    if (f.akteur_zustand.length) {
      const z = zustaendeAus(a);
      if (!f.akteur_zustand.some((w) => z.includes(w as AkteurZustand))) return false;
    }
    return true;
  });
}

export function sortiereAkteure(pool: AkteurZeile[]): AkteurZeile[] {
  return [...pool].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function sitzText(a: Pick<AkteurZeile, "sitzStrasse" | "sitzHausnummer" | "sitzPlz" | "sitzOrt">): string {
  const strasse = [a.sitzStrasse, a.sitzHausnummer].filter(Boolean).join(" ");
  const ort = [a.sitzPlz, a.sitzOrt].filter(Boolean).join(" ");
  return [strasse, ort].filter(Boolean).join(", ") || "–";
}
