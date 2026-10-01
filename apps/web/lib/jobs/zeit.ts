/**
 * AP2.4 PR b (E63): Der Cloudflare-Cron feuert um 03:00 und 04:00 UTC. Nur
 * der Aufruf, der in Europe/Berlin auf 05:00 faellt, laeuft weiter — so
 * laeuft der Job genau einmal taeglich um fuenf Uhr Berliner Zeit, auch ueber
 * die Zeitumstellung (Sommerzeit: 03:00 UTC; Winterzeit: 04:00 UTC). Keine
 * Offset-Rechnung von Hand — die Zeitzone entscheidet.
 */
import { ZEITZONE } from "../datum";

/** Stunde des Jobs in Berliner Zeit (Entscheidung Eric, AP2.4). */
export const JOB_STUNDE_BERLIN = 5;

const STUNDE = new Intl.DateTimeFormat("en-GB", { timeZone: ZEITZONE, hour: "2-digit", hourCycle: "h23" });

/** Stunde (0–23) des Zeitpunkts in Europe/Berlin. */
export function berlinStunde(zeitpunkt: Date): number {
  return Number(STUNDE.formatToParts(zeitpunkt).find((p) => p.type === "hour")!.value);
}

/** Faellt der Zeitpunkt in Berlin in diese Stunde? */
export function istBerlinStunde(zeitpunkt: Date, stunde: number): boolean {
  return berlinStunde(zeitpunkt) === stunde;
}
