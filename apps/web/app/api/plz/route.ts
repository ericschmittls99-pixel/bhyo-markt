import { withDb } from "@/lib/db";
import { PLZ_BESTAND_FEHLT, plzBestandVorhanden, pruefePlzOrt } from "@/lib/plz-server";
import { plzPruefungText } from "@/lib/plz-modell";
import { erstelleRateLimit } from "@/lib/rate-limit";
import { zugangFuerRoute } from "@/lib/rechte/wache";

/**
 * E68 PR 1: lokale PLZ-Pruefung, kein Netz-Austritt.
 * ?plz=&ort=   -> { plzBekannt, ortPasst, orte, text }
 * 503 mit Klartext, solange der PLZ-Bestand nicht importiert ist.
 * Nutzer in PR 2 (Knopf „Adresse pruefen") und PR 3 (Import, Zeile fuer Zeile).
 */
const erlaubt = erstelleRateLimit(30, 10_000);

export async function GET(req: Request) {
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  if (!erlaubt(wache.zugang.email, Date.now())) {
    return Response.json({ error: "Zu viele Anfragen — kurz warten." }, { status: 429 });
  }
  const p = new URL(req.url).searchParams;
  const plz = (p.get("plz") ?? "").trim();
  const ort = (p.get("ort") ?? "").trim().slice(0, 120);
  if (!/^[0-9]{5}$/.test(plz)) return Response.json({ error: "PLZ muss fünfstellig sein." }, { status: 400 });

  return withDb(async (db) => {
    if (!(await plzBestandVorhanden(db))) return Response.json({ error: PLZ_BESTAND_FEHLT }, { status: 503 });
    const e = await pruefePlzOrt(db, plz, ort || null);
    return Response.json({ ...e, text: plzPruefungText(e, plz) });
  });
}
