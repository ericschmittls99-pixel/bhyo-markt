import { getCloudflareContext } from "@opennextjs/cloudflare";

// Immer frisch auswerten: liefert Zeit und Laufzeit-Umgebung, nie aus dem Cache.
export const dynamic = "force-dynamic";

/**
 * Health-Check ohne Datenbankzugriff, ohne Secrets, ohne Nutzerdaten.
 * Wird später ggf. per Service Token oder eng begrenztem Bypass fürs Monitoring
 * freigegeben.
 */
export async function GET() {
  // `env` kommt aus der wrangler-Variable ENVIRONMENT (production | preview).
  // Außerhalb des Worker-Kontexts (z. B. reiner Node-Aufruf) fällt sie auf
  // "development" zurück.
  let env = "development";
  try {
    const context = await getCloudflareContext({ async: true });
    env = (context.env as { ENVIRONMENT?: string }).ENVIRONMENT ?? env;
  } catch {
    // getCloudflareContext nicht verfügbar – Fallback greift.
  }

  return Response.json({
    status: "ok",
    // Wird beim CI-Build als Variable gesetzt; lokal "dev".
    commit: process.env.COMMIT_SHA ?? "dev",
    env,
    time: new Date().toISOString(),
  });
}
