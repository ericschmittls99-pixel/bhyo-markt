import { dedupeAdressen, nurAdressenUndOrte, photonZuAdresse, REVERSE_RADIUS_KM, type Adresse } from "@/lib/geocode";

/**
 * Der eine Netz-Austritt zur Adresssuche (F0a, Photon — Begruendung in
 * lib/geocode.ts): fest gebaute URLs, nichts wird frei durchgereicht,
 * Zeitlimit 5 s. Genutzt vom Proxy /api/geocode (Browser) und vom Import
 * (Server, AP2.7 PR b, Sitz neuer Akteure). Eine Groesse, ein Ursprung.
 */
export const PHOTON = "https://photon.komoot.io";
// Grober Deutschland-Rahmen; zusaetzlich filtert der Mapper auf countrycode DE.
export const BBOX_DE = "5.5,47.1,15.6,55.1";

export class PhotonNichtErreichbar extends Error {}

async function hole(url: string): Promise<Adresse[]> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": "bhyo-markttool (intern)" }, signal: AbortSignal.timeout(5000) });
  } catch (e) {
    throw new PhotonNichtErreichbar(e instanceof Error ? e.message : "fetch");
  }
  if (!res.ok) throw new PhotonNichtErreichbar(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: unknown[] };
  return (data.features ?? []).map(photonZuAdresse).filter((a): a is Adresse => a != null);
}

/** Suche (Autocomplete und Import): Adressen, Orte, PLZ — keine Objekte. */
export async function photonSuche(q: string): Promise<Adresse[]> {
  const url = `${PHOTON}/api?q=${encodeURIComponent(q.trim().slice(0, 120))}&limit=5&lang=de&bbox=${BBOX_DE}`;
  return dedupeAdressen(nurAdressenUndOrte(await hole(url)));
}

/** Rueckwaertssuche fuer den Pin: alle Treffer im Radius (Auswahl macht der Aufrufer). */
export async function photonReverse(lat: number, lon: number): Promise<Adresse[]> {
  const url = `${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=de&limit=5&radius=${REVERSE_RADIUS_KM}&layer=house&layer=street`;
  return hole(url);
}
