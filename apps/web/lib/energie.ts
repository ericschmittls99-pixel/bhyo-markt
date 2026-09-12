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
// BEWUSST OHNE Faktor (kein stummer Fallback, Belege werden in der Kachel
// als "ohne Heizwert" ausgewiesen):
// - synthesegas, biofuels: Heizwert haengt von der Zusammensetzung ab —
//   zaehlen nur, wenn die Menge direkt in MWh/a erfasst ist.
// - co2, asche: stoffliche Outputs, kein Energieaequivalent.

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

/** Preis eines Output-Belegs in ct/kWh, oder null ohne Heizwert-Faktor. */
export function preisCtKwh(
  produktCode: string | null,
  preis: number | null,
  preisEinheit: string | null,
): number | null {
  if (preis == null || !preisEinheit) return null;
  if (preisEinheit === "€/MWh") return preis / 10;
  const hw = HEIZWERT[produktCode ?? ""];
  if (preisEinheit === "€/kg")
    return hw?.kwhProKg != null ? (preis / hw.kwhProKg) * 100 : null;
  if (preisEinheit === "€/t")
    return hw?.kwhProKg != null ? (preis / 1000 / hw.kwhProKg) * 100 : null;
  if (preisEinheit === "€/Nm³")
    return hw?.kwhProNm3 != null ? (preis / hw.kwhProNm3) * 100 : null;
  return null;
}

/** CO2-Preis in €/kg (aus €/t oder €/kg), sonst null. */
export function preisEuroKg(
  preis: number | null,
  preisEinheit: string | null,
): number | null {
  if (preis == null) return null;
  if (preisEinheit === "€/kg") return preis;
  if (preisEinheit === "€/t") return preis / 1000;
  return null;
}
