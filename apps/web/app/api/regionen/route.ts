import { erstelleRegion } from "@/lib/bewertung";
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

/** Weg 1: Fokusregion aus gezeichnetem Rechteck sofort anlegen. */
export async function POST(req: Request) {
  // F8/E30: Schreibrecht ueber die zentrale Wache, nicht "irgendwie angemeldet".
  // PROBE (rechte-check rot zeigen): Wache absichtlich entfernt.
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    bbox?: unknown;
  } | null;
  const name = body?.name?.trim();
  const bbox = normBbox(body?.bbox);
  if (!name) return Response.json({ error: "Name ist Pflicht" }, { status: 400 });
  if (!bbox)
    return Response.json({ error: "Ungültiges Gebiet" }, { status: 400 });

  const id = await erstelleRegion(name, bbox);
  return Response.json({ region: { id, name } }, { status: 201 });
}
