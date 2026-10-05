import { withDb } from "@/lib/db";
import { sucheAehnliche } from "@/lib/dubletten";
import { zugangFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/**
 * AP2.5 PR c (E66): „Meinten Sie …?" beim Anlegen im Beleg — aehnliche
 * Akteure zum eingegebenen Namen (pg_trgm ueber akteur_name_norm), Grad
 * stark/schwach mit Ortsbezug ueber PLZ oder den Kreis des Pins. Lesen reicht.
 */
export async function GET(req: Request) {
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const p = new URL(req.url).searchParams;
  const name = p.get("name") ?? "";
  const plz = p.get("plz")?.trim() || null;
  const lat = Number(p.get("lat"));
  const lng = Number(p.get("lng"));
  const pin = Number.isFinite(lat) && Number.isFinite(lng) && p.get("lat") && p.get("lng") ? { lat, lng } : null;
  return Response.json({ treffer: await withDb((db) => sucheAehnliche(db, name, plz, pin)) });
}
