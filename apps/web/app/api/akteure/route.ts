import { akteur } from "@bhyo/db/schema";

import { currentUserEmail, withDb } from "@/lib/db";
import { sucheAkteure } from "@/lib/register";

export const dynamic = "force-dynamic";

/** Live-Suche fuer die Akteur-Combobox. */
export async function GET(req: Request) {
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ akteure: await sucheAkteure(q) });
}

/** Inline-Neuanlage eines Akteurs (Name Pflicht, Sektor optional). */
export async function POST(req: Request) {
  if (!(await currentUserEmail())) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    sektor?: string;
  } | null;
  const name = body?.name?.trim();
  if (!name) {
    return Response.json({ error: "Name ist Pflicht" }, { status: 400 });
  }
  const sektor = body?.sektor?.trim() || null;

  const created = await withDb(async (db) => {
    const [row] = await db
      .insert(akteur)
      .values({ name, sektor, status: "entwurf" })
      .returning({ id: akteur.id, name: akteur.name, sektor: akteur.sektor });
    return row!;
  });

  return Response.json({ akteur: created }, { status: 201 });
}
