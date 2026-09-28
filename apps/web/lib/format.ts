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
 * E26: Rohwerte (t, MWh, Anzahl ...) als ganzzahlige ANTEILE an ihrer Summe,
 * Summe exakt 100 — Normierung plus Largest Remainder in einem Schritt.
 * `rundeAnteile100` erwartet bereits normierte Prozentwerte und ist dafuer
 * die falsche Funktion. Zwei Zusicherungen, auf die sich die Kacheln
 * verlassen: Summe 0 ergibt lauter 0 (kein 100-%-Phantom), und ein Wert 0
 * bekommt NIE einen Rest-Prozentpunkt.
 */
export function anteileProzent(werte: number[]): number[] {
  const summe = werte.reduce((a, b) => a + b, 0);
  if (summe <= 0) return werte.map(() => 0);
  const roh = werte.map((v) => (v / summe) * 100);
  const boden = roh.map(Math.floor);
  let rest = 100 - boden.reduce((a, b) => a + b, 0);
  const reihenfolge = roh
    .map((v, i) => ({ i, nachkomma: v - Math.floor(v) }))
    .filter(({ i }) => werte[i]! > 0)
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

/**
 * Wertspanne in der Anzeige (Rueckmeldung 1, 28.09.2026): „-54 bis -32 €/t".
 * Das Wort „bis" statt eines Strichs, weil der Halbgeviertstrich neben
 * negativen Preisen (E14: Annahmeentgelt) wie ein Minus liest. Gilt fuer
 * alle Wertspannen der Oberflaeche (Beleg, Strom-Detail, Preisband,
 * Tooltips); der Export fuehrt min und max weiter in eigenen Spalten.
 * min = max ergibt einen einzelnen Wert. Formatiert wird je Wert mit der
 * uebergebenen Groessenart-Funktion (E20), voreingestellt fmtPreis.
 */
export function formatSpanne(
  min: number,
  max: number,
  einheit: string,
  fmt: (n: number) => string = fmtPreis,
): string {
  const a = fmt(min);
  const b = fmt(max);
  const zahl = a === b ? a : `${a} bis ${b}`;
  return einheit ? `${zahl} ${einheit}` : zahl;
}

/**
 * Zeitspanne in Monaten (E40, 28.09.2026), Schwester von formatSpanne:
 * „01/2026 bis 12/2031"; ein offenes Ende wird benannt („ab 01/2026",
 * „bis 12/2031"), fehlen beide Grenzen „nicht erfasst" (E24) — nie ein
 * Strich, der neben Zahlen wie ein Minus liest. Beginn = Ende: ein Monat.
 */
export function formatZeitspanne(von: string | null, bis: string | null): string {
  const a = von ? fmtMonat(von) : null;
  const b = bis ? fmtMonat(bis) : null;
  if (a && b) return a === b ? a : `${a} bis ${b}`;
  if (a) return `ab ${a}`;
  if (b) return `bis ${b}`;
  return "nicht erfasst";
}

/** Verfuegbarkeitszeitraum — derselbe Ursprung wie formatZeitspanne. */
export function fmtZeitraum(von: string | null, bis: string | null): string {
  return formatZeitspanne(von, bis);
}
