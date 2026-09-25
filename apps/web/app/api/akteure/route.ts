import { akteur } from "@bhyo/db/schema";

import { sektorAusEingabe } from "@/lib/akteur-anlage";
import { withDb } from "@/lib/db";
import { ladeSektoren, sucheAkteure } from "@/lib/register";
import { wacheFuerRoute } from "@/lib/wache";

export const dynamic = "force-dynamic";

/** Live-Suche fuer die Akteur-Combobox. */
export async function GET(req: Request) {
  // F8/E30: Lesen reicht hier — ein Betrachter muss Auswahllisten sehen.
  const wache = await wacheFuerRoute("lesen");
  if (!wache.ok) return wache.antwort;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ akteure: await sucheAkteure(q) });
}

/**
 * Inline-Neuanlage eines Akteurs (Name Pflicht, Sektor optional). Der Sektor
 * muss ein Code der Referenztabelle sein (Fremdschluessel seit 0020) — ein
 * unbekannter Wert wird hier mit 400 und Nennung abgewiesen, nicht erst von
 * der Datenbank mit 500.
 */
export async function POST(req: Request) {
  // F8/E30: Schreibrecht ueber die zentrale Wache, nicht "irgendwie angemeldet".
  const wache = await wacheFuerRoute("schreiben");
  if (!wache.ok) return wache.antwort;
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    sektor?: string;
  } | null;
  const name = body?.name?.trim();
  if (!name) {
    return Response.json({ error: "Name ist Pflicht" }, { status: 400 });
  }
  const codes = (await ladeSektoren()).map((s) => s.code);
  const eingabe = sektorAusEingabe(body?.sektor, codes);
  if (!eingabe.ok) {
    return Response.json({ error: eingabe.fehler }, { status: 400 });
  }
  const sektor = eingabe.sektor;

  const created = await withDb(async (db) => {
    const [row] = await db
      .insert(akteur)
      .values({ name, sektor, status: "entwurf" })
      .returning({ id: akteur.id, name: akteur.name, sektor: akteur.sektor });
    return row!;
  });

  return Response.json({ akteur: created }, { status: 201 });
}
