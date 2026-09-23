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

/**
 * E27 (23.09.2026): Die Ringfarben sind THEME-ABHAENGIGE Tokens, keine
 * festen Hex-Werte mehr — die alte Navy-Rampe verschwand im Dark Mode
 * (A dunkelstes Navy auf Navy-Grund). Die Werte je Theme stehen in
 * globals.css; hier stehen nur noch die Verweise. Reihenfolge und
 * Strichart liefert `ringStil` in karte-modell.
 */
export const RING_FARBE: Record<string, string> = {
  A: "var(--ring-a)",
  B: "var(--ring-b)",
  C: "var(--ring-c)",
  D: "var(--ring-d)",
  unbelegt: "var(--ring-unbelegt)",
  ausserhalb: "var(--ring-ausserhalb)",
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

/** Ringfarbe (Rand) je Zustand — E24/E27, Tokens statt Hex. */
export function ringFarbeFuer(zustand: string): string {
  return RING_FARBE[zustand] ?? RING_FARBE.unbelegt!;
}

/**
 * Orb-Verlaufsbild eines Stroms (public/orbs): Biomasse traegt den
 * Cluster-Orb, Outputs den Gruppen-Orb; Add-Ons haben je Produkt einen
 * eigenen (waerme/co2/asche).
 */
export function orbSrc(s: {
  art: "biomasse" | "output";
  cluster: string | null;
  gruppe: string | null;
  produktCode: string | null;
}): string {
  if (s.art === "biomasse")
    return `/orbs/cluster/${s.cluster ?? "organische_rest_abfallstoffe"}.webp`;
  if (s.gruppe === "add_ons" && s.produktCode)
    return `/orbs/output/${s.produktCode}.webp`;
  return `/orbs/output/${s.gruppe ?? "primaerprodukte"}.webp`;
}
