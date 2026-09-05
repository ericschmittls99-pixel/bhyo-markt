// Kartenfarben (AP1f-a). Biomasse traegt die Farbe des Feedstock-Clusters,
// Output die Farbe seiner Gruppe (nicht je Produkt – vier gedeckte Gruppenfarben
// plus die Markerform trennen Input/Output; das Produkt traegt das Label). Der
// Qualitaets-RING bleibt Navy->Hellgrau (Graustufen, KEINE Ampelfarben).

export const CLUSTER_FARBE: Record<string, string> = {
  organische_rest_abfallstoffe: "#5C8615",
  lignozellulosische_reststoffe: "#9C7A4E",
  nachwachsende_rohstoffe: "#A1C65F",
  lipide_spezialfeedstocks: "#B7B7B4",
  polymere_synthetische_c_quellen: "#313F48",
};

export const CLUSTER_LABEL: Record<string, string> = {
  organische_rest_abfallstoffe: "Organische Rest- und Abfallstoffe",
  lignozellulosische_reststoffe: "Lignozellulosische Reststoffe",
  nachwachsende_rohstoffe: "Nachwachsende Rohstoffe",
  lipide_spezialfeedstocks: "Lipide und Spezialfeedstocks",
  polymere_synthetische_c_quellen: "Polymere und synth. Kohlenstoffquellen",
};

// Output-Farbe je GRUPPE (nicht je Produkt). #35529A statt eines helleren Blaus,
// weil #3F5FA0 zu nah an Petrol lag.
export const OUTPUT_FARBE: Record<string, string> = {
  primaerprodukte: "#DDB03C",
  wasserstoff: "#3AA0A0",
  derivate: "#35529A",
  add_ons: "#8E8880",
};

export const OUTPUT_LABEL: Record<string, string> = {
  primaerprodukte: "Primärprodukte",
  wasserstoff: "Wasserstoff",
  derivate: "Derivate",
  add_ons: "Add-Ons",
};

/** Qualitaets-Ring A->D: Navy -> Hellgrau, wie die Qualitaets-Pillen. */
export const QUALITAET_RING: Record<string, string> = {
  A: "#1F2E38",
  B: "#4a5c66",
  C: "#97a4ab",
  D: "#d5d8d6",
};

const UNBEKANNT = "#b9c0bd";

/**
 * Fuellfarbe eines Kartenpunkts. Biomasse: Cluster-Farbe (Schluessel =
 * materialart.cluster). Output: Gruppen-Farbe (Schluessel = output_produkt.gruppe).
 */
export function farbeFuer(art: "biomasse" | "output", farbeKey: string): string {
  if (art === "output") return OUTPUT_FARBE[farbeKey] ?? UNBEKANNT;
  return CLUSTER_FARBE[farbeKey] ?? UNBEKANNT;
}

/** Ringfarbe (Rand) anhand Qualitaet; ohne Bewertung dezenter Rand. */
export function ringFuer(qualitaet: string | null): string {
  return (qualitaet && QUALITAET_RING[qualitaet]) || "#b9c0bd";
}
