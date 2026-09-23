// Zahlen- und Datumsformate: de-DE, tabulare Ziffern kommen aus dem CSS.
// Volle Praezision bleibt intern — gerundet wird nur hier, an der
// Ausgabegrenze.
//
// E20 (22.09.2026): In der Darstellung KEINE Nachkommastellen — passt eine
// Groesse damit nicht, wechselt die EINHEIT, nicht die Regel. Deshalb eine
// Formatierungsfunktion JE GROESSENART statt einer generischen
// Preisformatierung; toFixed und punktuelle Formatierungen in Komponenten
// sind tabu. Genau zwei Ausnahmen, beide mit Kriterium:
//   a) fmtGeldGross: ab 1 Mio €/a EINE Nachkommastelle (= 100.000 €,
//      kein Rauschen).
//   b) fmtFaktor: Werte, die in einer sichtbar dargestellten Rechenkette
//      als FAKTOR auftreten (TS-Gehalt, Aschegehalt, Umwegfaktor, km-Satz,
//      Nutzlast), behalten die erfasste Genauigkeit — sonst ist die Kette
//      nicht mehr nachrechenbar.

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1fix = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const nfFaktor = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });

/** Mengen und Zaehlungen (t/a, MWh/a, Belegzahlen): ganzzahlig, 1.850. */
export function fmtMenge(n: number): string {
  return nf0.format(n);
}

/** Preise (€/t, €/MWh): ganzzahlig und signiert — 78 · -124 (E20). */
export function fmtPreis(n: number): string {
  return nf0.format(Math.round(n));
}

/** Quoten (Pruefquote, Erfassungsgrad): ganzzahlige Prozentangabe. */
export function fmtQuote(n: number): string {
  return `${nf0.format(Math.round(n))} %`;
}

/** Einzelner Anteil einer 100er-Summe (Saisonanteil): ganzzahlig. */
export function fmtAnteil(n: number): string {
  return `${nf0.format(Math.round(n))} %`;
}

/**
 * Geldbetraege pro Jahr: ab |1 Mio| in Mio. €/a mit genau EINER
 * Nachkommastelle (E20-Ausnahme a), darunter ganzzahlig in €/a.
 */
export function fmtGeldGross(v: number): { wert: string; einheit: string } {
  return Math.abs(v) >= 1_000_000
    ? { wert: nf1fix.format(v / 1_000_000), einheit: "Mio. €/a" }
    : { wert: nf0.format(Math.round(v)), einheit: "€/a" };
}

/**
 * Faktor einer sichtbar dargestellten Rechenkette (E20-Ausnahme b):
 * erfasste Genauigkeit, damit die angezeigte Rechnung nachrechenbar bleibt.
 */
export function fmtFaktor(n: number): string {
  return nfFaktor.format(n);
}

/**
 * Ganzzahlige Anteile mit Summe exakt 100 (Largest Remainder, E20):
 * abrunden, dann die Rest-Prozentpunkte an die groessten Nachkommareste
 * vergeben; bei Restgleichheit gewinnt der fruehere Index. Zentral —
 * KEINE lokalen Rundungslogiken (Restdifferenz-auf-letzten-Monat o. ae.).
 */
export function rundeAnteile100(werte: number[]): number[] {
  const boden = werte.map(Math.floor);
  let rest = 100 - boden.reduce((a, b) => a + b, 0);
  const reihenfolge = werte
    .map((v, i) => ({ i, nachkomma: v - Math.floor(v) }))
    .sort((a, b) => b.nachkomma - a.nachkomma || a.i - b.i);
  for (const { i } of reihenfolge) {
    if (rest <= 0) break;
    boden[i]! += 1;
    rest -= 1;
  }
  return boden;
}

/**
 * Feedstock-Zahlungsstrom (E14): preis_* ist aus Sicht bhyo signiert —
 * positiv = bhyo zahlt (Einkaufspreis), negativ = bhyo erhaelt
 * (Annahme-/Entsorgungsentgelt). Ein roher negativer Wert wird nie als
 * "Preis" gerendert; das Label kommt aus dem Vorzeichen.
 */
export function fmtZahlungsstrom(wert: number, einheit = "€/t"): string {
  return wert < 0
    ? `Annahmeentgelt ${fmtPreis(-wert)} ${einheit}`
    : `Einkaufspreis ${fmtPreis(wert)} ${einheit}`;
}

/** Koordinaten mit 4 Nachkommastellen (~11 m) — Ortsangabe, keine E20-Groessenart. */
export function fmtKoordinaten(lng: number, lat: number): string {
  const f = (n: number) => n.toFixed(4).replace(".", ",");
  return `${f(lat)}° N · ${f(lng)}° O`;
}

/** ISO-Datum -> MM/JJJJ. */
export function fmtMonat(iso: string | null): string {
  return iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "–";
}

/** ISO-Datum -> TT.MM.JJJJ. */
export function fmtDatum(iso: string | null): string {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "–";
}

/** Verfuegbarkeitszeitraum MM/JJJJ – MM/JJJJ. */
export function fmtZeitraum(von: string | null, bis: string | null): string {
  return `${fmtMonat(von)} – ${fmtMonat(bis)}`;
}
