/**
 * AP2.8 „Biomasse wird frei" (E70, Eric 07.10.2026) — die reine Regel, ein
 * Ursprung fuer Pille, Filter und (gespiegelt in SQL) den taeglichen Job in
 * lib/inbox/hinweise.ts.
 *
 *  1. frei_ab = Ende der Vergabekette eines Angebots (vergeben_bis), wenn
 *     keine Anschlussvergabe spaetestens am Folgetag beginnt. Eine Vergabe
 *     ohne Ende (bis NULL) macht den Strom nie frei. Nur Angebote
 *     (Biomasse), nicht das Ende des Verfuegbarkeitszeitraums.
 *  2. Gilt auch bei an_bhyo = true („Unsere Vergabe endet am …").
 *  3. Welche Kette zaehlt: deckt heute eine Vergabe ab, das Ende DIESER
 *     Kette (kleinstes Kettenende >= heute); sonst das juengste Kettenende
 *     vor heute („frei seit"), und gibt es keines, das naechste kuenftige.
 *  4. Staffel [180, 60, 30, 0] Tage: aktive Stufe = kleinste Stufe s mit
 *     Resttage <= s; Resttage <= 0 → Stufe 0; Resttage > 180 → kein Hinweis.
 *  5. Resttage = frei_ab − heute, beides Kalendertage Europe/Berlin
 *     (kalendertag()), als ISO-Daten gerechnet — keine Zeitzone im Modul.
 */
import { fmtDatum } from "./format";
import type { VergabeDaten } from "./verfuegbarkeit";

export const WIRD_FREI_STUFEN_STANDARD: readonly number[] = [180, 60, 30, 0];
/** Die vier Parameterschluessel der Staffel (Migration 0051) — in dieser Reihenfolge gelesen, dann normalisiert. */
export const WIRD_FREI_STUFEN_SCHLUESSEL = ["hinweis.wird_frei_stufe_1", "hinweis.wird_frei_stufe_2", "hinweis.wird_frei_stufe_3", "hinweis.wird_frei_stufe_4"] as const;

/**
 * E70 (Eric 08.10.2026): Die Staffel kommt aus vier Parametern — die Logik
 * sortiert absteigend und fasst gleiche Werte zusammen, die Reihenfolge der
 * Schluessel ist egal. Negative Werte weist die Parameter-Pruefung ab (min 0,
 * lib/parameter.ts und Trigger); hier bleibt das fail closed.
 */
export function normalisiereStufen(werte: readonly number[]): number[] {
  if (werte.some((w) => !Number.isInteger(w) || w < 0)) throw new Error("Wird-frei-Staffel: nur ganze Tage >= 0.");
  return [...new Set(werte)].sort((a, b) => b - a);
}
/** Filterwert der Verfuegbarkeits-Facette (E70, Punkt 13). */
export const WIRD_FREI = "wird_frei";
export const WIRD_FREI_LABEL = "Wird frei";

export interface FreiAb {
  /** Letzter Tag der Vergabekette (JJJJ-MM-TT); ab dem Folgetag ist der Strom frei. */
  freiAb: string;
  /** Die endende Vergabe war an bhyo (Textvariante „Unsere Vergabe endet am …"). */
  anBhyo: boolean;
}

function tagPlus(iso: string, tage: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** Tage zwischen zwei ISO-Daten (b − a), ganzzahlig. */
export function tageZwischen(a: string, b: string): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000);
}

/**
 * Kettenenden: jede Vergabe mit Ende, an die keine andere Vergabe desselben
 * Stroms anschliesst (Beginn <= Ende + 1 Tag und Ende danach oder offen).
 */
export function kettenEnden(vergaben: readonly VergabeDaten[]): { ende: string; anBhyo: boolean }[] {
  const enden: { ende: string; anBhyo: boolean }[] = [];
  for (const v of vergaben) {
    if (!v.vergebenBis) continue;
    const anschluss = vergaben.some(
      (w) => w !== v && (w.vergebenVon ?? "0000-01-01") <= tagPlus(v.vergebenBis!, 1) && (w.vergebenBis == null || w.vergebenBis > v.vergebenBis!),
    );
    if (!anschluss) enden.push({ ende: v.vergebenBis, anBhyo: v.anBhyo });
  }
  return enden.sort((a, b) => (a.ende < b.ende ? -1 : a.ende > b.ende ? 1 : 0));
}

/** frei_ab des Stroms zum Stichtag (Regel 1–3), oder null. */
export function freiAbAus(vergaben: readonly VergabeDaten[], heute: string): FreiAb | null {
  const enden = kettenEnden(vergaben);
  if (enden.length === 0) return null;
  const heuteVergeben = vergaben.some((v) => (v.vergebenVon ?? "0000-01-01") <= heute && (v.vergebenBis == null || v.vergebenBis >= heute));
  if (heuteVergeben) {
    const e = enden.find((x) => x.ende >= heute);
    return e ? { freiAb: e.ende, anBhyo: e.anBhyo } : null;
  }
  const vergangen = enden.filter((x) => x.ende < heute);
  const e = vergangen.length ? vergangen[vergangen.length - 1]! : enden[0]!;
  return { freiAb: e.ende, anBhyo: e.anBhyo };
}

/** Aktive Stufe (Regel 4): kleinste Stufe >= Resttage; Resttage <= 0 → 0; ueber der groessten Stufe → null. */
export function stufeFuer(resttage: number, stufen: readonly number[] = WIRD_FREI_STUFEN_STANDARD): number | null {
  if (resttage <= 0) return 0;
  // absteigend sortiert, ohne Doppelte — die kleinste passende Stufe steht hinten.
  const passend = normalisiereStufen(stufen).filter((s) => resttage <= s);
  return passend.length ? passend[passend.length - 1]! : null;
}

/** frei_ab samt Bewertung zum Stichtag — das, was Liste und Detail tragen (Strom.wirdFrei). */
export interface WirdFreiStand extends FreiAb {
  resttage: number;
  /** Aktive Stufe; null = mehr als die groesste Stufe entfernt (keine Pille, kein Filterwert). */
  stufe: number | null;
}

export function wirdFreiStand(vergaben: readonly VergabeDaten[], heute: string, stufen: readonly number[] = WIRD_FREI_STUFEN_STANDARD): WirdFreiStand | null {
  const f = freiAbAus(vergaben, heute);
  if (!f) return null;
  const resttage = tageZwischen(heute, f.freiAb);
  return { ...f, resttage, stufe: stufeFuer(resttage, stufen) };
}

export interface WirdFreiPille {
  text: string;
  tone: string;
  stufe: number;
}

/** Pille (Punkt 13): „frei ab TT.MM.JJJJ" ab 180 Tagen vorher, „frei seit TT.MM.JJJJ" ab frei_ab; sonst null. */
export function wirdFreiPill(stand: WirdFreiStand | null | undefined): WirdFreiPille | null {
  if (!stand || stand.stufe == null) return null;
  // „frei ab" = erster freier Tag (Folgetag des Kettenendes); „frei seit" ebenso.
  const tag = fmtDatum(tagPlus(stand.freiAb, 1));
  return stand.resttage <= 0 ? { text: `frei seit ${tag}.`, tone: "active", stufe: stand.stufe } : { text: `frei ab ${tag}.`, tone: "quiet", stufe: stand.stufe };
}

/** Text des Inbox-Hinweises je Stufe (Regel 2 und 7). */
export function wirdFreiText(objekt: string, f: FreiAb, stufe: number): string {
  const tag = fmtDatum(tagPlus(f.freiAb, 1));
  if (stufe === 0) return `${objekt} ist frei seit ${tag}`;
  return f.anBhyo ? `Unsere Vergabe von ${objekt} endet am ${fmtDatum(f.freiAb)} — frei ab ${tag}` : `${objekt} wird frei ab ${tag} (Vergabe endet ${fmtDatum(f.freiAb)})`;
}
