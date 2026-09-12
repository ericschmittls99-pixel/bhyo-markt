// Zahlen- und Datumsformate des V2-Mockups: de-DE, tabulare Ziffern kommen aus
// dem CSS. Volle Praezision bleibt intern — gerundet wird nur hier, an der
// Ausgabegrenze.

const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Ganzzahlformat fuer Mengen (1.850). */
export function fmtZahl(n: number): string {
  return nf0.format(n);
}

/** Preise: glatte Werte ohne, krumme mit zwei Nachkommastellen (9,50). */
export function fmtPreis(n: number): string {
  return Number.isInteger(n) ? nf0.format(n) : nf2.format(n);
}

const nf1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/**
 * Prozent-Anteile (TS, Asche): eine Nachkommastelle, damit die angezeigte
 * ConversionChain-Rechnung nachvollziehbar bleibt (8,5 % statt "9 %").
 */
export function fmtAnteil(n: number): string {
  return nf1.format(n);
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
