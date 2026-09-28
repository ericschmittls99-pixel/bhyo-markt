/**
 * E38 — Preiskorridor am Einzelstrom (Entscheidung Eric, 28.09.2026).
 *
 * Ein Strom zeigt seinen Korridor im Verhaeltnis zum Band seiner
 * Vergleichsgruppe: Feedstock gegen den Cluster, Output gegen die
 * Produktgruppe. Drei Vorgaben, jede mit Test:
 *   1. Der Strom wird NICHT in sein eigenes Vergleichsband gerechnet.
 *   2. Mindestens zwei Vergleichsstroeme MIT Preis, sonst der benannte
 *      Zustand "zu wenig Vergleichswerte" (E24). Wer keinen Preis hat, wird
 *      nicht als 0 gezaehlt, er ist kein Vergleichswert.
 *   3. Die Wertungsrichtung haengt von der Sicht ab: Feedstock — niedriger
 *      Preis ist "guenstiger fuer bhyo" (E14: positiv = bhyo zahlt);
 *      Outputs — hoeherer Erloes ist "besser fuer bhyo". Zwei getrennte
 *      Funktionen, kein gemeinsamer Vorzeichentrick.
 *
 * Feedstock-Band: preisKorridorRoh aus der Auswertung (atro-gewichtet, E14)
 * — derselbe Ursprung wie "preiskorridor je cluster.". Output-Band: Min /
 * Mittel / Max der Vergleichspreise in der Einheit des Stroms (€/t
 * stofflich, €/MWh energetisch, umgerechnet ueber den Heizwert, E23),
 * ungewichtet — die Auswertung kennt fuer Outputs keinen Korridor, hier
 * entsteht keiner mit zweiter Gewichtungslogik.
 */
import { preisKorridorRoh } from "./auswertung-modell";
import { STOFFLICHE_PRODUKTE } from "./energie";
import { fmtPreis } from "./format";
import { type Strom, energetischerPreis, stofflicherPreis } from "./stroeme-modell";

export const MINDEST_VERGLEICH = 2;
export const ZU_WENIG = "zu wenig Vergleichswerte";

export interface Band {
  min: number;
  mittel: number;
  max: number;
  /** Anzahl Vergleichsstroeme mit Preis. */
  n: number;
  /** z. B. "· ungewichtet" aus der Gewichtungsbasis. */
  zusatz: string | null;
}

export interface PreisKorridorEinzel {
  art: "biomasse" | "output";
  einheit: "€/t atro" | "€/t" | "€/MWh";
  /** Bezeichnung der Vergleichsgruppe (Cluster- bzw. Gruppenlabel). */
  gruppe: string;
  /** Eigener Korridor: Feedstock min/mittel/max, Output ein Punkt (min = mittel = max). */
  eigen: { min: number; mittel: number; max: number } | null;
  band: Band | null;
  /** Benannter Zustand statt Band, wenn keines gezeigt werden kann. */
  zustand: string | null;
  /** Wertungssatz aus der Sicht bhyo, nur wenn Band und eigener Wert vorliegen. */
  wertung: string | null;
}

/** Eigener Preis eines Outputs in der Anzeigeeinheit seiner Art, oder null. */
function outputPreis(s: Strom): number | null {
  const v = STOFFLICHE_PRODUKTE.has(s.produktCode ?? "") ? stofflicherPreis(s) : energetischerPreis(s);
  return typeof v === "number" ? v : null;
}

/**
 * Vorgabe 1 und 2: Vergleichsstroeme derselben Gruppe, ohne den Strom selbst,
 * nur mit Preis. Feedstock: gleicher Cluster und preisMittel gesetzt.
 * Output: gleiche Gruppe, gleiche Preisart (stofflich/energetisch) und ein
 * umrechenbarer Preis.
 */
export function vergleichsStroeme(strom: Strom, pool: Strom[]): Strom[] {
  if (strom.art === "biomasse") {
    return pool.filter(
      (s) => s.art === "biomasse" && s.id !== strom.id && s.cluster === strom.cluster && s.preisMittel != null,
    );
  }
  const stofflich = STOFFLICHE_PRODUKTE.has(strom.produktCode ?? "");
  return pool.filter(
    (s) =>
      s.art === "output" &&
      s.id !== strom.id &&
      s.gruppe === strom.gruppe &&
      STOFFLICHE_PRODUKTE.has(s.produktCode ?? "") === stofflich &&
      outputPreis(s) != null,
  );
}

/**
 * Vorgabe 3, Feedstock: E14 — positiv ist ein Zahlungsstrom VON bhyo. Ein
 * niedrigerer Mittelwert als das Band ist guenstiger fuer bhyo; im
 * negativen Bereich heisst das: hoeheres Annahmeentgelt.
 */
export function wertungFeedstock(eigenMittel: number, bandMittel: number): string {
  const diff = eigenMittel - bandMittel;
  const betrag = `${fmtPreis(Math.abs(diff))} €/t atro`;
  if (Math.round(diff) === 0) return "auf dem Cluster-Mittel";
  if (diff < 0) {
    return eigenMittel < 0 && bandMittel < 0
      ? `${betrag} höheres Annahmeentgelt als das Cluster-Mittel: günstiger für bhyo`
      : `${betrag} unter dem Cluster-Mittel: günstiger für bhyo`;
  }
  return eigenMittel < 0 && bandMittel < 0
    ? `${betrag} niedrigeres Annahmeentgelt als das Cluster-Mittel: teurer für bhyo`
    : `${betrag} über dem Cluster-Mittel: teurer für bhyo`;
}

/** Vorgabe 3, Outputs: Erloes fuer bhyo — mehr ist besser. */
export function wertungOutput(eigen: number, bandMittel: number, einheit: string): string {
  const diff = eigen - bandMittel;
  const betrag = `${fmtPreis(Math.abs(diff))} ${einheit}`;
  if (Math.round(diff) === 0) return "auf dem Gruppen-Mittel";
  return diff > 0
    ? `${betrag} über dem Gruppen-Mittel: besser für bhyo`
    : `${betrag} unter dem Gruppen-Mittel: schlechter für bhyo`;
}

export function preisKorridorEinzel(
  strom: Strom,
  pool: Strom[],
  labels: { cluster: Record<string, string> },
): PreisKorridorEinzel {
  const peers = vergleichsStroeme(strom, pool);

  if (strom.art === "biomasse") {
    const gruppe = strom.cluster ? (labels.cluster[strom.cluster] ?? strom.cluster) : "ohne Cluster";
    const eigen =
      strom.preisMittel != null
        ? { min: strom.preisMin ?? strom.preisMittel, mittel: strom.preisMittel, max: strom.preisMax ?? strom.preisMittel }
        : null;
    const basis = { art: "biomasse" as const, einheit: "€/t atro" as const, gruppe, eigen };
    if (peers.length < MINDEST_VERGLEICH) return { ...basis, band: null, zustand: ZU_WENIG, wertung: null };
    const roh = preisKorridorRoh(peers);
    if (roh.leer) return { ...basis, band: null, zustand: roh.hinweis ?? ZU_WENIG, wertung: null };
    const band: Band = { min: roh.min, mittel: roh.mittel, max: roh.max, n: peers.length, zusatz: roh.zusatz };
    return { ...basis, band, zustand: null, wertung: eigen ? wertungFeedstock(eigen.mittel, band.mittel) : null };
  }

  const stofflich = STOFFLICHE_PRODUKTE.has(strom.produktCode ?? "");
  const einheit = stofflich ? ("€/t" as const) : ("€/MWh" as const);
  const gruppe = strom.gruppeLabel ?? strom.gruppe ?? "ohne Gruppe";
  const preis = outputPreis(strom);
  const eigen = preis != null ? { min: preis, mittel: preis, max: preis } : null;
  const basis = { art: "output" as const, einheit, gruppe, eigen };
  if (peers.length < MINDEST_VERGLEICH) return { ...basis, band: null, zustand: ZU_WENIG, wertung: null };
  const werte = peers.map((s) => outputPreis(s)!);
  const band: Band = {
    min: Math.min(...werte),
    mittel: werte.reduce((a, b) => a + b, 0) / werte.length,
    max: Math.max(...werte),
    n: werte.length,
    zusatz: "· ungewichtet",
  };
  return { ...basis, band, zustand: null, wertung: eigen ? wertungOutput(eigen.mittel, band.mittel, einheit) : null };
}
