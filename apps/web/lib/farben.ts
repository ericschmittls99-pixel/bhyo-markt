// Kartenfarben. Kategoriale Palette fuer Materialart-Gruppen (Biomasse) und
// Vektoren (Output) – natuerliche, unterscheidbare Toene. Der Qualitaets-RING
// bleibt Navy->Hellgrau (Graustufen, KEINE Ampelfarben), analog zu den Pillen.

export const GRUPPE_FARBE: Record<string, string> = {
  gruenschnitt_landschaftspflege: "#8CC63F",
  holz_rebschnitt: "#8B5E3C",
  bioabfall_kompost: "#3A5412",
  klaerschlamm: "#5B7A99",
  agrar_lebensmittelreststoffe: "#C79A3B",
};

export const GRUPPE_LABEL: Record<string, string> = {
  gruenschnitt_landschaftspflege: "Grünschnitt / Landschaftspflege",
  holz_rebschnitt: "Holz / Rebschnitt",
  bioabfall_kompost: "Bioabfall / Kompost",
  klaerschlamm: "Klärschlamm",
  agrar_lebensmittelreststoffe: "Agrar / Lebensmittelreststoffe",
};

export const VEKTOR_FARBE: Record<string, string> = {
  waerme: "#D97A34",
  h2: "#3AA0A0",
  co2: "#6C7A89",
};

export const VEKTOR_LABEL: Record<string, string> = {
  waerme: "Wärme",
  h2: "H₂",
  co2: "CO₂",
};

/** Qualitaets-Ring A->D: Navy -> Hellgrau, wie die Qualitaets-Pillen. */
export const QUALITAET_RING: Record<string, string> = {
  A: "#1F2E38",
  B: "#4a5c66",
  C: "#97a4ab",
  D: "#d5d8d6",
};

const UNBEKANNT = "#b9c0bd";

/** Fuellfarbe eines Kartenpunkts anhand Art + Farbschluessel (Gruppe/Vektor). */
export function farbeFuer(art: "biomasse" | "output", farbeKey: string): string {
  if (art === "output") return VEKTOR_FARBE[farbeKey] ?? UNBEKANNT;
  return GRUPPE_FARBE[farbeKey] ?? UNBEKANNT;
}

/** Ringfarbe (Rand) anhand Qualitaet; ohne Bewertung dezenter Rand. */
export function ringFuer(qualitaet: string | null): string {
  return (qualitaet && QUALITAET_RING[qualitaet]) || "#b9c0bd";
}
