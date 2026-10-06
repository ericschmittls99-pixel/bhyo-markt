import { dedupeAdressen, nurAdressenUndOrte, photonZuAdresse, REVERSE_RADIUS_KM, type Adresse } from "@/lib/geocode";

/**
 * Der eine Netz-Austritt zur Adresssuche (F0a, Photon — Begruendung in
 * lib/geocode.ts): fest gebaute URLs, nichts wird frei durchgereicht,
 * Zeitlimit PHOTON_ZEITLIMIT_MS. Genutzt vom Proxy /api/geocode (Browser)
 * und vom Import (Server, AP2.7 PR b). Eine Groesse, ein Ursprung.
 *
 * Diagnose (Eric 06.10.2026, Production-Fehler „Adresssuche nicht
 * erreichbar"): jeder Fehlschlag wird mit Upstream-Status, gekuerzter
 * Antwort, Ursache und Dauer geloggt (GEOCODE_FEHLER …) und als
 * PhotonNichtErreichbar mit denselben Feldern geworfen — die Oberflaeche
 * bekommt eine klare Meldung, das Log den Beleg. Im Log stehen keine
 * Nutzereingaben im Klartext: nur die Laenge der Suche bzw. das Pin-Raster.
 */
export const PHOTON = "https://photon.komoot.io";
export const PHOTON_ZEITLIMIT_MS = 5000;
/** Aussagekraeftige Kennung statt „intern" — Photon bittet darum (Fair Use). */
export const PHOTON_USER_AGENT = "bhyo-markt/1.0 (+kontakt@bhyo.de)";
// Grober Deutschland-Rahmen; zusaetzlich filtert der Mapper auf countrycode DE.
export const BBOX_DE = "5.5,47.1,15.6,55.1";

export type PhotonUrsache = "zeitlimit" | "netz" | "http" | "antwort";

export interface PhotonDiagnose {
  ursache: PhotonUrsache;
  /** HTTP-Status des Upstreams, null wenn keine Antwort kam. */
  status: number | null;
  dauerMs: number;
  /** Gekuerzte Upstream-Antwort oder Fehlertext (max. 200 Zeichen). */
  antwort: string;
}

export class PhotonNichtErreichbar extends Error {
  constructor(public readonly diagnose: PhotonDiagnose) {
    super(photonMeldung(diagnose));
  }
}

/** Klartext fuer die Oberflaeche — nennt die Ursache, nicht nur „nicht erreichbar". */
export function photonMeldung(d: PhotonDiagnose): string {
  switch (d.ursache) {
    case "zeitlimit":
      return `Adresssuche hat nach ${Math.round(PHOTON_ZEITLIMIT_MS / 1000)} s nicht geantwortet — Adresse und Pin lassen sich vollständig von Hand setzen.`;
    case "http":
      return `Adresssuche antwortet mit Fehler ${d.status} — Adresse und Pin lassen sich vollständig von Hand setzen.`;
    case "antwort":
      return "Adresssuche hat unlesbar geantwortet — Adresse und Pin lassen sich vollständig von Hand setzen.";
    default:
      return "Adresssuche nicht erreichbar (Netz/DNS) — Adresse und Pin lassen sich vollständig von Hand setzen.";
  }
}

/** Ursache aus dem Fehler eines fetch-Aufrufs: Zeitlimit (AbortSignal.timeout) oder Netz/DNS. */
export function ursacheAusFehler(e: unknown): PhotonUrsache {
  const name = e instanceof Error ? e.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "zeitlimit" : "netz";
}

async function hole(url: string, kennung: string): Promise<Adresse[]> {
  const start = Date.now();
  const scheitere = (d: Omit<PhotonDiagnose, "dauerMs">): never => {
    const diagnose: PhotonDiagnose = { ...d, dauerMs: Date.now() - start };
    console.error(`GEOCODE_FEHLER ${JSON.stringify({ ...diagnose, kennung, ua: PHOTON_USER_AGENT })}`);
    throw new PhotonNichtErreichbar(diagnose);
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": PHOTON_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(PHOTON_ZEITLIMIT_MS) });
  } catch (e) {
    return scheitere({ ursache: ursacheAusFehler(e), status: null, antwort: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 200) });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return scheitere({ ursache: "http", status: res.status, antwort: text.replace(/\s+/g, " ").slice(0, 200) });
  }
  let data: { features?: unknown[] };
  try {
    data = (await res.json()) as { features?: unknown[] };
  } catch (e) {
    return scheitere({ ursache: "antwort", status: res.status, antwort: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
  }
  return (data.features ?? []).map(photonZuAdresse).filter((a): a is Adresse => a != null);
}

/** Suche (Autocomplete und Import): Adressen, Orte, PLZ — keine Objekte. */
export async function photonSuche(q: string): Promise<Adresse[]> {
  const text = q.trim().slice(0, 120);
  const url = `${PHOTON}/api?q=${encodeURIComponent(text)}&limit=5&lang=de&bbox=${BBOX_DE}`;
  // Kennung ohne Klartext: nur die Laenge der Eingabe.
  return dedupeAdressen(nurAdressenUndOrte(await hole(url, `suche laenge=${text.length}`)));
}

/** Rueckwaertssuche fuer den Pin: alle Treffer im Radius (Auswahl macht der Aufrufer). */
export async function photonReverse(lat: number, lon: number): Promise<Adresse[]> {
  const url = `${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=de&limit=5&radius=${REVERSE_RADIUS_KM}&layer=house&layer=street`;
  // Kennung auf ein 0,1°-Raster gerundet (≈ 10 km), kein genauer Standort im Log.
  return hole(url, `reverse raster=${lat.toFixed(1)},${lon.toFixed(1)}`);
}
