/**
 * E56 „Für mich" (29.09.2026): Ein Strom ist „für mich", wenn er von mir
 * gesperrt ist ODER mir zugewiesen ODER ich beteiligt bin — beteiligt im
 * Sinne von beteiligte() aus AP2.2 (Protokoll-Arten angelegt, geaendert,
 * status_gesetzt, verworfen). Sperre und Zuweisungen stehen bereits am
 * geladenen Strom; die Beteiligung kommt als EINE Menge aus dem Protokoll
 * (ladeBeteiligungen in ./fuer-mich-server.ts) — kein Nachladen je Zeile.
 *
 * Betrachter koennen nicht beteiligt sein (sie schreiben nichts, werden nicht
 * zugewiesen, sperren nicht): Fuer sie gibt es den Schalter nicht — ein
 * Filter ohne Wirkung wird nicht angezeigt.
 */
import type { Zugang } from "@/lib/rechte";
import type { Strom } from "@/lib/stroeme-modell";

export const FUER_MICH_LEER = "Keine Einträge, an denen du beteiligt bist.";

export interface FuerMichKriterien {
  gesperrtVonMir: boolean;
  mirZugewiesen: boolean;
  beteiligt: boolean;
}

export function kriterienFuer(s: Strom, nutzerId: string, beteiligt: ReadonlySet<string>): FuerMichKriterien {
  return {
    gesperrtVonMir: s.sperre?.von.id === nutzerId,
    mirZugewiesen: (s.zuweisungen ?? []).some((z) => z.id === nutzerId),
    beteiligt: beteiligt.has(s.id),
  };
}

export function istFuerMich(s: Strom, nutzerId: string, beteiligt: ReadonlySet<string>): boolean {
  const k = kriterienFuer(s, nutzerId, beteiligt);
  return k.gesperrtVonMir || k.mirZugewiesen; // PROBE: Beteiligung entfernt
}

/** Reichert das Flag einmal je Request am Pool an (wie Verfuegbarkeit/Verifikation). */
export function reichereFuerMichAn(pool: Strom[], nutzerId: string, beteiligt: ReadonlySet<string>): Strom[] {
  return pool.map((s) => ({ ...s, fuerMich: istFuerMich(s, nutzerId, beteiligt) }));
}

/** Wer den Schalter sieht: jeder Zugang ausser Betrachter. */
export function zeigeFuerMich(zugang: Zugang): boolean {
  return zugang.art === "erlaubt" && zugang.rolle !== "betrachter";
}

/** Zustand des Schalters aus dem Filterwert. */
export function fuerMichAktiv(fuer: string): boolean {
  return fuer === "mich";
}
