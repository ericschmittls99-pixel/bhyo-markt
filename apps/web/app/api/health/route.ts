import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createSql } from "@bhyo/db";

// Immer frisch auswerten: liefert Zeit, Laufzeit-Umgebung und DB-Status, nie aus dem Cache.
export const dynamic = "force-dynamic";

interface HealthBindings {
  ENVIRONMENT?: string;
  HYPERDRIVE?: { connectionString: string };
}

/** Prueft die Neon-Anbindung ueber Hyperdrive mit `SELECT postgis_version()`. */
async function checkDb(bindings: HealthBindings): Promise<"ok" | "error"> {
  const connectionString = bindings.HYPERDRIVE?.connectionString;
  if (!connectionString) return "error";

  const sql = createSql(connectionString);
  try {
    await sql`SELECT postgis_version()`;
    return "ok";
  } catch {
    return "error";
  } finally {
    await sql.end().catch(() => {});
  }
}

/**
 * Health-Check ohne Secrets und ohne Nutzerdaten. Zeigt zusaetzlich den DB-Status,
 * damit die Hyperdrive-Anbindung ohne Datenbank-Client von aussen sichtbar ist.
 * Wird spaeter ggf. per Service Token oder eng begrenztem Bypass fuers Monitoring
 * freigegeben.
 */
export async function GET() {
  // `env` kommt aus der wrangler-Variable ENVIRONMENT (production | preview);
  // ausserhalb des Worker-Kontexts (reiner Node-Aufruf) faellt sie auf
  // "development" zurueck, `db` dann auf "error".
  let env = "development";
  let db: "ok" | "error" = "error";

  try {
    const bindings = (await getCloudflareContext({ async: true }))
      .env as unknown as HealthBindings;
    env = bindings.ENVIRONMENT ?? env;
    db = await checkDb(bindings);
  } catch {
    // getCloudflareContext nicht verfuegbar – Fallbacks greifen.
  }

  return Response.json({
    status: "ok",
    // Wird beim CI-Build als Variable gesetzt; lokal "dev".
    commit: process.env.COMMIT_SHA ?? "dev",
    env,
    db,
    time: new Date().toISOString(),
  });
}
