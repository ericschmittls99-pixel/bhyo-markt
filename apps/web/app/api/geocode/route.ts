import { REVERSE_RADIUS_KM, waehleTrefferAusPin, type Adresse } from "@/lib/geocode";
import { PhotonNichtErreichbar, photonLetzteDauerMs, photonMeldung, photonReverse, photonSuche } from "@/lib/photon-server";
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
 * ?lat=&lon=   Rueckwaertssuche fuer den verschobenen Pin: bis zu 5 Treffer
 *              im Radius (layer house/street, Photon kennt limit, radius und
 *              layer bei /reverse — gemessen 05.10.2026), zurueck kommt nur
 *              der naechstgelegene Treffer mit PLZ (lib/geocode).
 *
 * Die Suche ist Bequemlichkeit, kein Tor: Ist der Dienst nicht erreichbar,
 * antwortet die Route mit 502 und einem Klartext, der auf die vollstaendige
 * manuelle Eingabe (inklusive Pin) hinweist.
 */
// 10 Aufrufe je 10 s je Nutzer: Tippen mit 350-ms-Debounce bleibt weit
// darunter; ein Script laeuft in die Wand. Der Netz-Austritt selbst sitzt
// in lib/photon-server.ts (seit AP2.7 PR b auch vom Import genutzt).
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

  if (q.length < 3 && !latLonOk) return Response.json({ adressen: [] });

  try {
    // Sitz-Erfassung b: Die Suche bietet Adressen, Orte und PLZ an. Die
    // Rueckwaertssuche liefert genau den naechsten Treffer mit PLZ im Radius —
    // oder nichts, dann bleibt das Feld leer und der Hinweis sagt es.
    const adressen =
      q.length >= 3
        ? await photonSuche(q)
        : [waehleTrefferAusPin({ lng: lon, lat }, await photonReverse(lat, lon), REVERSE_RADIUS_KM)].filter((a): a is Adresse => a != null);
    // Dauer des Upstream-Aufrufs auch bei Erfolg — fuer die Messung (Diagnose 06.10.2026).
    return Response.json({ adressen, dauerMs: photonLetzteDauerMs() });
  } catch (e) {
    // Diagnose mit an die Oberflaeche: Ursache, Status und Dauer stehen auch im
    // Log (GEOCODE_FEHLER) — hier, damit sich der Fehler im Browser belegen laesst.
    const d = e instanceof PhotonNichtErreichbar ? e.diagnose : null;
    return Response.json(
      {
        error: d ? photonMeldung(d) : "Adresssuche nicht erreichbar — Adresse und Pin lassen sich vollständig von Hand setzen.",
        ursache: d?.ursache ?? "unbekannt",
        status: d?.status ?? null,
        dauerMs: d?.dauerMs ?? null,
      },
      { status: 502 },
    );
  }
}
