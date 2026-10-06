import { pruefeAdresse } from "@/lib/adresse-pruefung-server";
import { withDb } from "@/lib/db";
import { PhotonNichtErreichbar, photonMeldung, photonSuche } from "@/lib/photon-server";
import { erstelleRateLimit } from "@/lib/rate-limit";
import { zugangFuerRoute } from "@/lib/rechte/wache";

/**
 * E68 PR 2: Adresspruefung auf Knopfdruck — eine Anfrage je Klick, keine je
 * Tastendruck. Lesender GET wie /api/geocode (Firmenadressen, keine
 * Personendaten; die Wachen behandeln nur GET als Leseweg):
 *   ?strasse=&hausnummer=&plz=&ort=   -> PruefAntwort
 *   ?q=                               -> { adressen }  (freie Suche, bis 5 Treffer)
 * Lesen laeuft ueber die Wache (fail closed); 10 Aufrufe je 10 s je Nutzer.
 */
const erlaubt = erstelleRateLimit(10, 10_000);
const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function GET(req: Request) {
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  if (!erlaubt(wache.zugang.email, Date.now())) {
    return Response.json({ error: "Zu viele Anfragen — kurz warten." }, { status: 429 });
  }
  const p = new URL(req.url).searchParams;

  if (p.has("q")) {
    const q = text(p.get("q"));
    if (q.length < 3) return Response.json({ adressen: [] });
    try {
      return Response.json({ adressen: await photonSuche(q) });
    } catch (e) {
      const d = e instanceof PhotonNichtErreichbar ? e.diagnose : null;
      return Response.json({ error: d ? photonMeldung(d) : "Adresssuche nicht erreichbar — Adresse und Pin lassen sich vollständig von Hand setzen." }, { status: 502 });
    }
  }

  const eingabe = { strasse: text(p.get("strasse")), hausnummer: text(p.get("hausnummer"), 20), plz: text(p.get("plz"), 10), ort: text(p.get("ort")) };
  return withDb(async (db) => Response.json(await pruefeAdresse(db, eingabe)));
}
