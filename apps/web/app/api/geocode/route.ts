import { photonZuAdresse, type Adresse } from "@/lib/geocode";
import { currentUserEmail } from "@/lib/db";

/**
 * Geocoding-Proxy (F0a): einziger Netz-Austritt fuer die Adresssuche —
 * der Browser spricht nie direkt mit dem Dienst, der Worker-Egress bleibt
 * auf genau einen Host begrenzt. Dienst-Begruendung in lib/geocode.ts
 * (Photon; Nominatim verbietet Autocomplete, BKG braucht einen Vertrag).
 *
 * ?q=          Suche (Autocomplete), Debounce liegt im Client
 * ?lat=&lon=   Rueckwaertssuche fuer den verschobenen Pin
 *
 * Die Suche ist Bequemlichkeit, kein Tor: Ist der Dienst nicht erreichbar,
 * antwortet die Route mit 502 und einem Klartext, der auf die vollstaendige
 * manuelle Eingabe (inklusive Pin) hinweist.
 */
const PHOTON = "https://photon.komoot.io";
// Grober Deutschland-Rahmen; zusaetzlich filtert der Mapper auf countrycode DE.
const BBOX_DE = "5.5,47.1,15.6,55.1";

export async function GET(req: Request) {
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const p = new URL(req.url).searchParams;
  const q = p.get("q")?.trim() ?? "";
  const lat = p.get("lat");
  const lon = p.get("lon");

  let url: string;
  if (q.length >= 3) {
    url = `${PHOTON}/api?q=${encodeURIComponent(q)}&limit=5&lang=de&bbox=${BBOX_DE}`;
  } else if (lat && lon) {
    url = `${PHOTON}/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&lang=de`;
  } else {
    return Response.json({ adressen: [] });
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "bhyo-markttool (intern)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Photon ${res.status}`);
    const data = (await res.json()) as { features?: unknown[] };
    const adressen = (data.features ?? [])
      .map(photonZuAdresse)
      .filter((a): a is Adresse => a != null);
    return Response.json({ adressen });
  } catch {
    return Response.json(
      {
        error:
          "Adresssuche nicht erreichbar — Adresse und Pin lassen sich vollständig von Hand setzen.",
      },
      { status: 502 },
    );
  }
}
