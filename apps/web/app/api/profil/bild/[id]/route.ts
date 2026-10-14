import { benutzer } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { getBelegeBucket, withDb } from "@/lib/db";
import { zugangFuerRoute } from "@/lib/rechte/wache";

// Immer frisch: liest die verifizierte Identitaet, die Zeile und ein R2-Objekt.
export const dynamic = "force-dynamic";

/**
 * E77 R7: Profilbild eines Nutzers — nur fuer angemeldete Nutzer (Wache, fail
 * closed), fuer jeden Nutzer mit Zugang sichtbar (Avatare stehen app-weit). Der
 * R2-Key kommt AUS DER ZEILE, nie aus der URL: die Adresse nennt nur die
 * Nutzer-ID, ein Key laesst sich darueber nicht erraten oder durchprobieren.
 * Privat gecacht: die URL traegt die Version (bild_geaendert_am), ein neues
 * Bild bekommt eine neue URL, ein geteilter Cache sieht nie etwas.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const wache = await zugangFuerRoute();
  if (!wache.ok) return wache.antwort;

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Kein Profilbild" }, { status: 404 });
  const zeile = await withDb(async (db) => {
    const [z] = await db.select({ bildKey: benutzer.bildKey }).from(benutzer).where(eq(benutzer.id, id)).limit(1);
    return z ?? null;
  });
  if (!zeile?.bildKey) return Response.json({ error: "Kein Profilbild" }, { status: 404 });

  const objekt = await (await getBelegeBucket()).get(zeile.bildKey);
  if (!objekt) return Response.json({ error: "Kein Profilbild" }, { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", objekt.httpMetadata?.contentType ?? "application/octet-stream");
  headers.set("Cache-Control", "private, max-age=86400");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(objekt.body, { headers });
}
