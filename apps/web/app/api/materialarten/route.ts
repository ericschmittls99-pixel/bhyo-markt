import { feedstockCluster, materialart } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { withDb } from "@/lib/db";
import { sucheMaterialarten } from "@/lib/register";
import { wacheFuerRoute, zugangFuerRoute } from "@/lib/rechte/wache";

export const dynamic = "force-dynamic";

/** Leitet einen stabilen Code aus dem Label ab: snake_case, ohne Umlaute. */
function toCode(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Live-Suche fuer die Materialart-Combobox. */
export async function GET(req: Request) {
  // F8/E30: Lesen reicht hier — ein Betrachter muss Auswahllisten sehen.
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ materialarten: await sucheMaterialarten(q) });
}

/** Inline-Neuanlage einer Materialart (Label -> abgeleiteter Code). */
export async function POST(req: Request) {
  // F8/E30: Schreibrecht ueber die zentrale Wache, nicht "irgendwie angemeldet".
  const wache = await wacheFuerRoute("materialart.anlegen");
  if (!wache.ok) return wache.antwort;
  const body = (await req.json().catch(() => null)) as {
    label?: string;
    cluster?: string;
  } | null;
  const label = body?.label?.trim();
  const code = label ? toCode(label) : "";
  const cluster = body?.cluster;
  if (!label || !code) {
    return Response.json({ error: "Label ist Pflicht" }, { status: 400 });
  }
  if (!cluster || !(feedstockCluster.enumValues as string[]).includes(cluster)) {
    return Response.json({ error: "Cluster ist Pflicht" }, { status: 400 });
  }

  const created = await withDb(async (db) => {
    // Bestehenden Code nie ueberschreiben – bei Kollision den vorhandenen zurueckgeben.
    await db
      .insert(materialart)
      .values({ code, label, cluster: cluster as never })
      .onConflictDoNothing();
    const [row] = await db
      .select({ code: materialart.code, label: materialart.label })
      .from(materialart)
      .where(eq(materialart.code, code));
    return row!;
  });

  return Response.json({ materialart: created }, { status: 201 });
}
