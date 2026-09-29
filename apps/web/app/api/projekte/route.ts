import { erstelleRegionUndStarte, starteLauf } from "@/lib/bewertung";
import { wacheFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

function normBbox(bbox: unknown): [number, number, number, number] | null {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    bbox.some((n) => typeof n !== "number" || !Number.isFinite(n))
  ) {
    return null;
  }
  const [a, b, c, d] = bbox as number[];
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

/**
 * Weg 2: Projekt starten – entweder fuer eine bestehende Fokusregion
 * ({ regionId }) oder fuer eine neu gezeichnete ({ name, bbox }, wird nur hier,
 * beim Start, persistiert). Legt jeweils den ersten analyse_lauf (arbeitsfassung) an.
 */
export async function POST(req: Request) {
  // F8/E30: Schreibrecht ueber die zentrale Wache, nicht "irgendwie angemeldet".
  const wache = await wacheFuerRoute("projekt.starten");
  if (!wache.ok) return wache.antwort;
  const body = (await req.json().catch(() => null)) as {
    regionId?: string;
    name?: string;
    bbox?: unknown;
  } | null;

  if (body?.regionId) {
    const laufId = await starteLauf(wache.zugang, body.regionId);
    return Response.json({ laufId }, { status: 201 });
  }

  const name = body?.name?.trim();
  const bbox = normBbox(body?.bbox);
  if (!name) return Response.json({ error: "Name ist Pflicht" }, { status: 400 });
  if (!bbox)
    return Response.json({ error: "Ungültiges Gebiet" }, { status: 400 });

  const { regionId, laufId } = await erstelleRegionUndStarte(wache.zugang, name, bbox);
  return Response.json({ regionId, laufId }, { status: 201 });
}
