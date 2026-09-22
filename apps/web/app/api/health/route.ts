import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createSql } from "@bhyo/db";
import journal from "@bhyo/db/journal";

import { fehlendeMigrationen } from "@/lib/schema-stand";

// Immer frisch auswerten: liefert Zeit, Laufzeit-Umgebung und DB-Status, nie aus dem Cache.
export const dynamic = "force-dynamic";

interface HealthBindings {
  ENVIRONMENT?: string;
  HYPERDRIVE?: { connectionString: string };
}

/**
 * Prueft die Neon-Anbindung UND den Schema-Stand (E21, 22.09.2026): die im
 * Build enthaltenen Migrationen (Drizzle-Journal) muessen alle in
 * drizzle.__drizzle_migrations angewendet sein. Fehlt eine, meldet der Check
 * "schema: behind" samt Namen — der Deploy soll dann brechen, nicht /register.
 */
async function checkDb(
  bindings: HealthBindings,
): Promise<{ db: "ok" | "error"; fehlend: string[] }> {
  const connectionString = bindings.HYPERDRIVE?.connectionString;
  if (!connectionString) return { db: "error", fehlend: [] };

  const sql = createSql(connectionString);
  try {
    await sql`SELECT postgis_version()`;
    let whens: (number | string)[] = [];
    try {
      const rows =
        await sql`SELECT created_at FROM drizzle.__drizzle_migrations`;
      whens = rows.map((r) => r.created_at as string);
    } catch {
      // Migrationstabelle fehlt (nie migrierte DB) -> alles fehlt.
    }
    return { db: "ok", fehlend: fehlendeMigrationen(journal.entries, whens) };
  } catch {
    return { db: "error", fehlend: [] };
  } finally {
    await sql.end().catch(() => {});
  }
}

/**
 * Health-Check ohne Secrets und ohne Nutzerdaten. Zeigt DB-Status und
 * Schema-Stand, damit ein zurueckliegendes Produktionsschema von aussen
 * sichtbar wird (HTTP 503 + "schema: behind"), statt erst im Seiten-Crash.
 */
export async function GET() {
  // `env` kommt aus der wrangler-Variable ENVIRONMENT (production | preview);
  // ausserhalb des Worker-Kontexts (reiner Node-Aufruf) faellt sie auf
  // "development" zurueck, `db` dann auf "error".
  let env = "development";
  let db: "ok" | "error" = "error";
  let fehlend: string[] = [];

  try {
    const bindings = (await getCloudflareContext({ async: true }))
      .env as unknown as HealthBindings;
    env = bindings.ENVIRONMENT ?? env;
    ({ db, fehlend } = await checkDb(bindings));
  } catch {
    // getCloudflareContext nicht verfuegbar – Fallbacks greifen.
  }

  const schemaBehind = fehlend.length > 0;
  return Response.json(
    {
      status: schemaBehind ? "schema_behind" : "ok",
      // Wird beim CI-Build als Variable gesetzt; lokal "dev".
      commit: process.env.COMMIT_SHA ?? "dev",
      env,
      db,
      schema: schemaBehind ? "behind" : "ok",
      ...(schemaBehind ? { fehlendeMigrationen: fehlend } : {}),
      time: new Date().toISOString(),
    },
    { status: schemaBehind ? 503 : 200 },
  );
}
