// Adress-Geocoding (F0a): pure Mapper fuer Photon-Antworten — ohne Netz,
// damit das Mapping ohne Infrastruktur testbar ist. Der Netz-Aufruf lebt
// ausschliesslich in app/api/geocode/route.ts (Worker-Egress).
//
// Dienst-Entscheidung (F0a, 23.09.2026): Photon (photon.komoot.io).
// - Nominatim (öffentliche Instanz) verbietet Autocomplete ausdruecklich
//   ("you must not implement such a service", Usage Policy) — damit fuer
//   ein Suchfeld mit Vorschlagsliste ungeeignet.
// - Der BKG-Geokodierungsdienst ist nur fuer Bundesbehoerden/berechtigte
//   Nutzer frei; gewerbliche Nutzung erfordert einen Vertrag ueber die
//   ZSGT/DLZ — als Default ungeeignet, spaeter als Upgrade moeglich.
// - Photon ist fuer Search-as-you-type gebaut, Fair-Use ("please be fair —
//   extensive usage will be throttled"), OSM-Daten (ODbL) mit Attribution
//   "© OpenStreetMap-Mitwirkende", Open Source und damit selbst hostbar,
//   falls die oeffentliche Instanz je nicht mehr reicht.

/**
 * Sitz-Erfassung b (05.10.2026): Art des Treffers, gemessen an Photon-Antworten.
 * adresse = hat eine Strasse · ort = place (Stadt, Gemeinde, Ortsteil …) ·
 * plz = place/postcode (Photon traegt die PLZ dort NUR im Namen, postcode ist
 * leer) · objekt = alles andere ohne Strasse (Bach, Fluss, Flur) — fuer die
 * Rueckwaertssuche noch brauchbar (city), in der Suche nicht als Ort anzubieten.
 */
export type TrefferArt = "adresse" | "ort" | "plz" | "objekt";

export interface Adresse {
  art: TrefferArt;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  lng: number;
  lat: number;
}

/** Photon-GeoJSON-Feature -> Adresse; null bei Nicht-DE oder ohne Koordinate. */
export function photonZuAdresse(feature: unknown): Adresse | null {
  const f = feature as {
    geometry?: { coordinates?: unknown } | null;
    properties?: Record<string, unknown> | null;
  } | null;
  const p = f?.properties ?? null;
  const coords = f?.geometry?.coordinates;
  if (!p || !Array.isArray(coords) || coords.length < 2) return null;
  // Suchraum ist Deutschland (zusaetzlich zur bbox im API-Aufruf).
  if (p.countrycode !== "DE") return null;
  const [lng, lat] = coords as [number, number];
  if (typeof lng !== "number" || typeof lat !== "number") return null;

  const s = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  const strasse = s(p.street);
  const istPlace = p.osm_key === "place";
  const art: TrefferArt =
    strasse != null ? "adresse" : istPlace ? (p.osm_value === "postcode" ? "plz" : "ort") : "objekt";
  // Bei Orts-Treffern (place) ist der Ortsname `name`, sonst steht der Ort in
  // `city`; ein Objekt (Bach, Flur) gibt seinen Namen nie als Ort aus.
  const ort = s(p.city) ?? (art === "ort" ? s(p.name) : null);
  return {
    art,
    strasse,
    hausnummer: s(p.housenumber),
    plz: art === "plz" ? s(p.name) : s(p.postcode),
    ort,
    lng,
    lat,
  };
}

/** Suche: nur Adressen, Orte und PLZ anbieten — Objekte ohne Strasse (Fluss, Flur) nicht. */
export function nurAdressenUndOrte(adressen: Adresse[]): Adresse[] {
  return adressen.filter((a) => a.art !== "objekt");
}

/** Kompaktes Anzeige-Label ("Hauptstraße 12, 67346 Speyer"). */
/** Nimmt jedes Objekt mit den vier Adressfeldern (Adresse, Standort, Fixture). */
export function adresseLabel<T extends Pick<Adresse, "strasse" | "hausnummer" | "plz" | "ort">>(a: T): string {
  const strasse = [a.strasse, a.hausnummer].filter(Boolean).join(" ");
  const ort = [a.plz, a.ort].filter(Boolean).join(" ");
  return [strasse, ort].filter(Boolean).join(", ");
}

/**
 * Photon liefert dieselbe Adresse oft mehrfach (Node, Way-Centroid, POI).
 * Dedupe-Schluessel: Label + auf 3 Nachkommastellen (~100 m) gerundete
 * Koordinate — grob genug fuer Objekt-Duplikate, fein genug, um gleiche
 * Strassennamen in verschiedenen Orten zu behalten.
 */
export function dedupeAdressen(adressen: Adresse[]): Adresse[] {
  const gesehen = new Set<string>();
  return adressen.filter((a) => {
    const k = `${adresseLabel(a)}|${a.lat.toFixed(3)}|${a.lng.toFixed(3)}`;
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
}
