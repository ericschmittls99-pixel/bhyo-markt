/**
 * Kalendertag in Europe/Berlin (AP2.3 PR b, Beschluss Eric 30.09.2026).
 *
 * Jede Stelle, an der ein Zeitpunkt zu einem Datum wird — beleg.erstellt_am
 * als Erhebungsdatum, der Reservierungs-Stempel, „heute" als Stichtag der
 * Fristen — misst am Kalendertag Europe/Berlin. Das passt zum CHECK
 * „nie rueckwirkend" in parameter_wert (Migration 0029) und zur Aufloesung
 * der Fristen in SQL (lib/stroeme.ts, `at time zone`). Vorher lief ein Teil
 * ueber die UTC-Darstellung (toISOString): zwischen 00:00 und 02:00 Berlin
 * lag ein Beleg damit einen Tag frueher als am Bildschirm — und am Tag einer
 * Friständerung bekam er die alte Frist.
 */
export const ZEITZONE = "Europe/Berlin";

const FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZEITZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** JJJJ-MM-TT des Zeitpunkts in Europe/Berlin. */
export function kalendertag(zeitpunkt: Date): string {
  const teile = FORMAT.formatToParts(zeitpunkt);
  const t = (typ: string) => teile.find((p) => p.type === typ)!.value;
  return `${t("year")}-${t("month")}-${t("day")}`;
}

/** Heutiges Datum in Europe/Berlin — Stichtag der Fristen und Mass der Regel „nie rueckwirkend". */
export function heuteBerlin(jetzt: Date = new Date()): string {
  return kalendertag(jetzt);
}
