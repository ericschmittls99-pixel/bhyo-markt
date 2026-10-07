// Euro-Potenzial je Strom — EIN Ursprung für Auswertung (Kacheln, Module) und
// Export (E36). Vorzeichen nach E18: positiv = Erlös für bhyo.
import { energieKwh, preisEuroMwh, preisEuroT, STOFFLICHE_PRODUKTE } from "./energie";
import { preisAtro } from "./preis-bezug";
import type { Strom } from "./stroeme-modell";

/**
 * Feedstock (E18, revidiert aus E14): preis_* ist der signierte Zahlungsstrom
 * aus Sicht bhyo (positiv = bhyo zahlt). Das Potenzial flippt das Vorzeichen:
 * -(Preis mittel × t atro). Null ohne Preis oder ohne atro-Menge.
 */
export function potenzialEuroFeedstock(s: Strom): number | null {
  // E69: Rechnung mit dem abgeleiteten Preis €/t atro; nicht vergleichbar → kein Potenzial.
  const preis = preisAtro(s.preisMittel, s.preisBezug, s.tsAnteil);
  if (preis == null || s.mengeAtro == null) return null;
  return -(preis * s.mengeAtro);
}

/**
 * Output: energetisch über €/MWh × MWh, stofflich (CO2/Asche) über €/t × t/a.
 * Null ohne umrechenbaren Preis.
 */
export function potenzialEuroOutput(s: Strom): number | null {
  if (STOFFLICHE_PRODUKTE.has(s.produktCode ?? "")) {
    const eurT = preisEuroT(s.preis, s.preisEinheit);
    if (eurT == null || s.mengeWert == null || s.mengeEinheit !== "t/a") return null;
    return eurT * s.mengeWert;
  }
  const eurMwh = preisEuroMwh(s.produktCode, s.preis, s.preisEinheit);
  const kwh = energieKwh(s.produktCode, s.mengeWert, s.mengeEinheit);
  return eurMwh != null && kwh != null ? (eurMwh * kwh) / 1000 : null;
}
