import { dedupeAdressen, photonZuAdresse, type Adresse } from "@/lib/geocode";
import { erstelleRateLimit } from "@/lib/rate-limit";
import { zugangFuerRoute } from "@/lib/rechte/wache";

/**
 * Geocoding-Proxy (F0a): einziger Netz-Austritt fuer die Adresssuche —
 * der Browser spricht nie direkt mit dem Dienst, der Worker-Egress bleibt
 * auf genau einen Host begrenzt. Dienst-Begruendung in lib/geocode.ts
 * (Photon; Nominatim verbietet Autocomplete, BKG braucht einen Vertrag).
 *
 * KEIN offener Proxy: es werden ausschliesslich die validierten Parameter
 * q bzw. lat/lon in eine fest gebaute URL uebernommen (nichts wird frei
 * durchgereicht), und je Nutzer gilt eine Ratenbegrenzung.
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
// 10 Aufrufe je 10 s je Nutzer: Tippen mit 350-ms-Debounce bleibt weit
// darunter; ein Script laeuft in die Wand.
const erlaubt = erstelleRateLimit(10, 10_000);

export async function GET(req: Request) {
  // F8/E30: auch Lesen laeuft ueber die Wache — eine unbekannte oder
  // deaktivierte Adresse darf keine Daten sehen (fail closed).
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const email = wache.zugang.email;
  if (!erlaubt(email, Date.now())) {
    return Response.json(
      { error: "Zu viele Anfragen — kurz warten und weitertippen." },
      { status: 429 },
    );
  }

  const p = new URL(req.url).searchParams;
  const q = (p.get("q") ?? "").trim().slice(0, 120);
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  const latLonOk =
    Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  let url: string;
  if (q.length >= 3) {
    url = `${PHOTON}/api?q=${encodeURIComponent(q)}&limit=5&lang=de&bbox=${BBOX_DE}`;
  } else if (latLonOk) {
    url = `${PHOTON}/reverse?lat=${lat}&lon=${lon}&lang=de`;
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
    const adressen = dedupeAdressen(
      (data.features ?? [])
        .map(photonZuAdresse)
        .filter((a): a is Adresse => a != null),
    );
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
