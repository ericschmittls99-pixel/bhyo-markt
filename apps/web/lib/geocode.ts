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

export interface Adresse {
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  ort: string | null;
  bundesland: string | null;
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
  // Bei Orts-Treffern (type city/town/village/…) ist der Ortsname `name`,
  // bei Adress-Treffern steht der Ort in `city`.
  const ort = s(p.city) ?? (s(p.street) == null ? s(p.name) : null);
  return {
    strasse: s(p.street),
    hausnummer: s(p.housenumber),
    plz: s(p.postcode),
    ort,
    bundesland: s(p.state),
    lng,
    lat,
  };
}

/** Kompaktes Anzeige-Label ("Hauptstraße 12, 67346 Speyer"). */
export function adresseLabel(a: Adresse): string {
  const strasse = [a.strasse, a.hausnummer].filter(Boolean).join(" ");
  const ort = [a.plz, a.ort].filter(Boolean).join(" ");
  return [strasse, ort].filter(Boolean).join(", ");
}
