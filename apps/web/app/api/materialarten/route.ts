import { materialart } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { currentUserEmail, withDb } from "@/lib/db";
import { sucheMaterialarten } from "@/lib/register";

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
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ materialarten: await sucheMaterialarten(q) });
}

/** Inline-Neuanlage einer Materialart (Label -> abgeleiteter Code). */
export async function POST(req: Request) {
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { label?: string } | null;
  const label = body?.label?.trim();
  const code = label ? toCode(label) : "";
  if (!label || !code) {
    return Response.json({ error: "Label ist Pflicht" }, { status: 400 });
  }

  const created = await withDb(async (db) => {
    // Bestehenden Code nie ueberschreiben – bei Kollision den vorhandenen zurueckgeben.
    await db.insert(materialart).values({ code, label }).onConflictDoNothing();
    const [row] = await db
      .select({ code: materialart.code, label: materialart.label })
      .from(materialart)
      .where(eq(materialart.code, code));
    return row!;
  });

  return Response.json({ materialart: created }, { status: 201 });
}
