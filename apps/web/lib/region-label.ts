// Sitz-Erfassung c (AP2.5, 05.10.2026): Kreis und Land als Kurzform hinter
// jedem Treffer — „Freiburg (Elbe) · Lkr. Stade · NI". Anlass: die
// Verwechslung Freiburg (Elbe) / Freiburg im Breisgau im Bearbeiten-Ablauf.
// Pure Funktionen; gespeist aus Photon (county/state) oder aus der
// VG250-Tabelle verwaltungsgebiet (name + bez) ueber die View akteur_verwaltung.
import { adresseLabel, type Adresse } from "./geocode";

/** Amtliche Laenderkuerzel; Photon und VG250 nennen die Laender bei ihrem Namen. */
const LAND_KUERZEL: Record<string, string> = {
  "Baden-Württemberg": "BW",
  Bayern: "BY",
  Berlin: "BE",
  Brandenburg: "BB",
  Bremen: "HB",
  "Freie Hansestadt Bremen": "HB",
  Hamburg: "HH",
  "Freie und Hansestadt Hamburg": "HH",
  Hessen: "HE",
  "Mecklenburg-Vorpommern": "MV",
  Niedersachsen: "NI",
  "Nordrhein-Westfalen": "NW",
  "Rheinland-Pfalz": "RP",
  Saarland: "SL",
  Sachsen: "SN",
  "Sachsen-Anhalt": "ST",
  "Schleswig-Holstein": "SH",
  Thüringen: "TH",
};

export function landKuerzel(land: string | null | undefined): string | null {
  if (!land) return null;
  return LAND_KUERZEL[land] ?? land;
}

/**
 * Kurzform des Kreises. Ohne `bez` (Photon-county) wird nur das Praefix
 * „Landkreis " gekuerzt. Mit `bez` (VG250): Landkreis → „Lkr. X", Kreis →
 * „Kreis X", Regionalverband → „Regionalverband X"; eine kreisfreie Stadt oder
 * ein Stadtkreis ist der Ort selbst und entfaellt (sonst stuende „Speyer · Speyer").
 */
export function kreisKurz(name: string | null | undefined, bez?: string | null): string | null {
  if (!name) return null;
  if (bez == null) return name.replace(/^Landkreis\s+/u, "Lkr. ");
  const b = bez.trim().toLowerCase();
  if (b === "landkreis") return `Lkr. ${name}`;
  if (b === "kreisfreie stadt" || b === "stadtkreis") return null;
  if (b === "") return name;
  return `${bez.trim()} ${name}`;
}

export function regionLabel(r: { kreis: string | null; land: string | null; kreisBez?: string | null }): string {
  return [kreisKurz(r.kreis, r.kreisBez), landKuerzel(r.land)].filter(Boolean).join(" · ");
}

/** „21729 Freiburg (Elbe) · Lkr. Stade · NI" — Adresse, dann Region. */
export function adresseLabelMitRegion(a: Adresse): string {
  return [adresseLabel(a), regionLabel(a)].filter(Boolean).join(" · ");
}
