// Energie-Umrechnung der Output-Bedarfe (AP1i PR 7, Review-Runde 3 Eric):
// Mengen und Preise der Target-Outputs werden ueber den UNTEREN Heizwert (Hu)
// auf kWh normiert. Reines Modul ohne Datenbank/Netz; volle Praezision intern
// (Faktoren als MJ/3,6-Brueche), gerundet wird erst an der Ausgabegrenze.
//
// Quellen der Heizwerte:
// - Wasserstoff 119,972 MJ/kg · 10,783 MJ/Nm³; Methan 50,013 MJ/kg ·
//   35,883 MJ/Nm³; Methanol 19,9 MJ/kg; Ethanol 26,8 MJ/kg:
//   https://de.wikipedia.org/wiki/Heizwert (Tabellen gasfoermige/fluessige
//   Brennstoffe, Hu bei 25 °C)
// - Ammoniak 18,6 MJ/kg: UBA-Kurzeinschaetzung "Ammoniak als Energietraeger"
//   (umweltbundesamt.de) bzw. IEA-AMF Fuel Information Ammonia
// - SAF/Jet A-1 43,15 MJ/kg (Spezifikation min. ~42,8 MJ/kg):
//   Jet-A-1-Spezifikation (DEF STAN 91-091 / ASTM D1655)
//
// Referenzwerte (E13, Eric 21.09.26): Synthesegas und BioFuels bekommen
// Industriestandard-Heizwerte statt "ohne Heizwert" — der tatsaechliche Wert
// haengt von der Zusammensetzung ab, die Referenz macht t/a-Belege vergleichbar:
// - Synthesegas 12 MJ/Nm³ (Mitte der Literaturspanne 10–16 MJ/Nm³ trocken fuer
//   Zweibett-Wirbelschicht-Dampfvergasung von Biomasse, Pfad der biogenen
//   H2-Produktion, Referenzanlage Guessing; sciencedirect.com Reviews zu DFB-
//   Gasification). Massebasis 13,3 MJ/kg ueber typische Produktgasdichte
//   ~0,9 kg/Nm³ (H2~40 · CO~25 · CO2~20 · CH4~10 Vol-%).
// - BioFuels 37,0 MJ/kg (FAME-Biodiesel, RED II Anhang III / Richtlinie (EU)
//   2018/2001; bewusst konservativ gegenueber HVO ~44 MJ/kg).
//
// BEWUSST OHNE Faktor: co2, asche — stoffliche Outputs, kein Energieaequivalent.

import { fmtFaktor, fmtPreis } from "./format";

interface Heizwert {
  kwhProKg?: number;
  kwhProNm3?: number;
}

const H2: Heizwert = { kwhProKg: 119.972 / 3.6, kwhProNm3: 10.783 / 3.6 };

export const HEIZWERT: Record<string, Heizwert> = {
  methan: { kwhProKg: 50.013 / 3.6, kwhProNm3: 35.883 / 3.6 },
  ethanol: { kwhProKg: 26.8 / 3.6 },
  h2_niederdruck: H2,
  h2_hochdruck: H2,
  h2_einspeisung_kernnetz: H2,
  liquid_hydrogen: H2,
  methanol: { kwhProKg: 19.9 / 3.6 },
  saf: { kwhProKg: 43.15 / 3.6 },
  ammoniak: { kwhProKg: 18.6 / 3.6 },
  synthesegas: { kwhProKg: 13.3 / 3.6, kwhProNm3: 12 / 3.6 },
  biofuels: { kwhProKg: 37.0 / 3.6 },
};

/**
 * Jahres-Energiebedarf eines Output-Belegs in kWh/a, oder null wenn das
 * Produkt in dieser Einheit kein belegbares Energieaequivalent hat.
 */
export function energieKwh(
  produktCode: string | null,
  mengeWert: number | null,
  mengeEinheit: string | null,
): number | null {
  if (mengeWert == null || !mengeEinheit) return null;
  if (mengeEinheit === "MWh/a") return mengeWert * 1000;
  const hw = HEIZWERT[produktCode ?? ""];
  if (mengeEinheit === "t/a")
    return hw?.kwhProKg != null ? mengeWert * 1000 * hw.kwhProKg : null;
  if (mengeEinheit === "Nm³/a")
    return hw?.kwhProNm3 != null ? mengeWert * hw.kwhProNm3 : null;
  return null;
}

/**
 * Preis eines energetischen Output-Belegs in €/MWh (E20-Anzeigeeinheit,
 * ersetzt ct/kWh), oder null ohne Heizwert-Faktor.
 */
export function preisEuroMwh(
  produktCode: string | null,
  preis: number | null,
  preisEinheit: string | null,
): number | null {
  if (preis == null || !preisEinheit) return null;
  if (preisEinheit === "€/MWh") return preis;
  const hw = HEIZWERT[produktCode ?? ""];
  if (preisEinheit === "€/kg")
    return hw?.kwhProKg != null ? (preis / hw.kwhProKg) * 1000 : null;
  if (preisEinheit === "€/t")
    return hw?.kwhProKg != null ? preis / hw.kwhProKg : null;
  if (preisEinheit === "€/Nm³")
    return hw?.kwhProNm3 != null ? (preis / hw.kwhProNm3) * 1000 : null;
  return null;
}

/** Stofflicher Preis in €/t (E20-Anzeigeeinheit, aus €/t oder €/kg), sonst null. */
export function preisEuroT(
  preis: number | null,
  preisEinheit: string | null,
): number | null {
  if (preis == null) return null;
  if (preisEinheit === "€/kg") return preis * 1000;
  if (preisEinheit === "€/t") return preis;
  return null;
}

/** Stoffliche Output-Produkte (Rest energetisch) — eine Quelle fuer Modell und Detail. */
export const STOFFLICHE_PRODUKTE = new Set(["co2", "asche"]);

/**
 * Output-Preis fuer die Anzeige (E20): die erfasste Einheit wird nicht mehr
 * roh gezeigt, sondern in die Anzeigeeinheit umgerechnet — stofflich €/t,
 * energetisch €/MWh, jeweils ganzzahlig. Ist keine Umrechnung belegbar
 * (kein Referenz-Heizwert), bleibt der Rohwert in erfasster Genauigkeit.
 */
export function fmtOutputPreis(
  produktCode: string | null,
  preis: number | null,
  preisEinheit: string | null,
): string {
  if (preis == null) return "–";
  if (STOFFLICHE_PRODUKTE.has(produktCode ?? "")) {
    const eurT = preisEuroT(preis, preisEinheit);
    if (eurT != null) return `${fmtPreis(eurT)} €/t`;
  } else {
    const eurMwh = preisEuroMwh(produktCode, preis, preisEinheit);
    if (eurMwh != null) return `${fmtPreis(eurMwh)} €/MWh`;
  }
  return `${fmtFaktor(preis)} ${preisEinheit ?? ""}`.trim();
}
