/**
 * Betrieb (Entscheidung Eric 04.10.2026): Welcher Stichtag ist fuer die
 * Job-Wache faellig? Der Verifikations-Job laeuft um 05:00 Berlin; ab 05:30
 * Berlin muss der heutige Lauf stehen, davor gilt der gestrige. Keine
 * Stundensperre mehr — jeder Aufruf prueft (GitHub startet geplante Laeufe
 * oft Stunden zu spaet; die alte Wache endete dann gruen, ohne zu pruefen).
 * Reine Funktion ueber die Zeitzone Europe/Berlin, Sommer- und Winterzeit
 * inklusive (Test: job-wache-stichtag.test.ts).
 */
export const WACHE_AB_MINUTE_BERLIN = 5 * 60 + 30;

const TEILE = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Datum (JJJJ-MM-TT) und Minute des Tages in Berlin. */
export function berlinZeit(jetzt: Date): { datum: string; minuteDesTages: number } {
  const p = Object.fromEntries(TEILE.formatToParts(jetzt).map((x) => [x.type, x.value]));
  return { datum: `${p.year}-${p.month}-${p.day}`, minuteDesTages: Number(p.hour) * 60 + Number(p.minute) };
}

function vortag(datum: string): string {
  const [j, m, t] = datum.split("-").map(Number);
  return new Date(Date.UTC(j!, m! - 1, t!) - 86_400_000).toISOString().slice(0, 10);
}

/** Faelliger Stichtag: ab 05:30 Berlin heute, davor gestern. */
export function faelligerStichtag(jetzt: Date): { stichtag: string; grund: "heute" | "gestern" } {
  const { datum, minuteDesTages } = berlinZeit(jetzt);
  return minuteDesTages >= WACHE_AB_MINUTE_BERLIN ? { stichtag: datum, grund: "heute" } : { stichtag: vortag(datum), grund: "gestern" };
}
