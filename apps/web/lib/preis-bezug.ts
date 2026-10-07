/**
 * E69 (Eric 07.10.2026): Der Feedstock-Preis wird mit seinem Bezug erfasst —
 * je Tonne Frischmasse (fm) oder je Tonne atro. Ein Bezug gilt fuer
 * preis_min, preis_mittel und preis_max gemeinsam; das Vorzeichen bleibt wie
 * in E14 (positiv = bhyo zahlt). Die Auswertung (Potenzial, Preiskorridor
 * E38) rechnet mit dem ABGELEITETEN Preis €/t atro, der nie gespeichert wird
 * (E23):
 *   atro                      → unveraendert
 *   fm mit TS-Anteil          → Preis ÷ TS-Anteil (als Anteil, nicht in %)
 *   fm ohne TS-Anteil, unbekannt → „nicht vergleichbar": der Strom faellt aus
 *                               Korridor und Potenzial heraus, seine Zahl wird
 *                               sichtbar genannt. Nichts rechnet still mit dem Rohwert.
 * Reine Funktionen, ein Ursprung fuer Auswertung, Export und Detail.
 */
export const PREIS_BEZUEGE = ["fm", "atro"] as const;
export type PreisBezugWahl = (typeof PREIS_BEZUEGE)[number];

export const PREIS_BEZUG_LABEL: Record<string, string> = {
  fm: "€/t FM",
  atro: "€/t atro",
  unbekannt: "Bezug unbekannt",
};

export const NICHT_VERGLEICHBAR = "nicht vergleichbar";
export const NICHT_VERGLEICHBAR_GRUND = "Preis-Bezug FM ohne TS-Anteil oder unbekannt";

export interface PreisTraeger {
  preisMin: number | null;
  preisMittel: number | null;
  preisMax: number | null;
  preisBezug: string | null;
  /** TS-Anteil in Prozent (Strom.tsAnteil). */
  tsAnteil: number | null;
}

/** Einen Rohpreis in €/t atro bringen; null = nicht vergleichbar. */
export function preisAtro(roh: number | null, bezug: string | null, tsAnteilPct: number | null): number | null {
  if (roh == null) return null;
  if (bezug === "atro") return roh;
  if (bezug === "fm" && tsAnteilPct != null && tsAnteilPct > 0) return roh / (tsAnteilPct / 100);
  return null;
}

/** Korridor des Stroms in €/t atro (Min/Mittel/Max, fehlende Seiten aus dem Mittel), oder null ohne vergleichbaren Mittelwert. */
export function preisAtroVon(s: PreisTraeger): { min: number; mittel: number; max: number } | null {
  const mittel = preisAtro(s.preisMittel, s.preisBezug, s.tsAnteil);
  if (mittel == null) return null;
  return {
    min: preisAtro(s.preisMin, s.preisBezug, s.tsAnteil) ?? mittel,
    mittel,
    max: preisAtro(s.preisMax, s.preisBezug, s.tsAnteil) ?? mittel,
  };
}

/** Hat der Strom einen Preis, der aber nicht in €/t atro gebracht werden kann? */
export function preisNichtVergleichbar(s: PreisTraeger): boolean {
  return s.preisMittel != null && preisAtroVon(s) == null;
}

/** Anzeige des Bezugs hinter einem Preis: „€/t FM", „€/t atro", „€/t (Bezug unbekannt)". */
export function preisEinheitAnzeige(bezug: string | null): string {
  if (bezug === "fm" || bezug === "atro") return PREIS_BEZUG_LABEL[bezug]!;
  return "€/t (Bezug unbekannt)";
}

/** Zusatz fuer Spannen und Kacheln: „· 2 nicht vergleichbar", leer bei 0. */
export function nichtVergleichbarZusatz(n: number): string | null {
  return n > 0 ? `· ${n} ${NICHT_VERGLEICHBAR}` : null;
}
