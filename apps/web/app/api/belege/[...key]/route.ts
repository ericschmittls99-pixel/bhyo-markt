import { currentUserEmail, getBelegeBucket } from "@/lib/db";

// Immer frisch: liest die verifizierte Identitaet und ein R2-Objekt, nie aus dem Cache.
export const dynamic = "force-dynamic";

/**
 * Liefert eine Beleg-Datei aus R2 aus. Zugriff nur mit von der Middleware
 * verifizierter Identitaet (Access blockt zusaetzlich am Edge) – kein oeffentlicher
 * Bucket, keine signierte URL: die Route streamt direkt ueber die R2-Bindung.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const email = await currentUserEmail();
  if (!email) {
    return Response.json({ error: "Nicht authentifiziert" }, { status: 403 });
  }

  const { key: segments } = await ctx.params;
  const key = segments.join("/");

  const bucket = await getBelegeBucket();
  const objekt = await bucket.get(key);
  if (!objekt) {
    return Response.json({ error: "Beleg nicht gefunden" }, { status: 404 });
  }

  const headers = new Headers();
  objekt.writeHttpMetadata?.(headers);
  headers.set(
    "Content-Type",
    objekt.httpMetadata?.contentType ?? "application/octet-stream",
  );
  // Belege nie in geteilten Caches ablegen – sie liegen hinter Access.
  headers.set("Cache-Control", "private, no-store");

  return new Response(objekt.body, { headers });
}
