import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createSql } from "@bhyo/db";
import * as schema from "@bhyo/db/schema";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { headers } from "next/headers";

import { ACCESS_EMAIL_HEADER } from "@/lib/access";

export type AppDb = PostgresJsDatabase<typeof schema>;

/** Von R2 zurueckgegebenes Objekt (nur die hier genutzten Felder). */
export interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
  writeHttpMetadata?: (headers: Headers) => void;
}

/**
 * Minimales R2-Bucket-Interface (put/get). Bewusst kein @cloudflare/workers-types
 * – die App haelt es wie bei der HYPERDRIVE-Bindung mit eigenen schmalen Typen.
 */
export interface BelegeBucket {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  /** AP2.7 PR b: Roh-Upload des Imports nach der Zuordnung loeschen (E67). */
  delete(key: string): Promise<void>;
  /** AP2.7 PR b: liegengebliebene Roh-Uploads finden (Job, 24 h). */
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>;
}

interface AppBindings {
  ENVIRONMENT?: string;
  HYPERDRIVE?: { connectionString: string };
  BELEGE?: BelegeBucket;
  /** E68 PR 2: Basis-URL des Adressdienstes (Standard Photon, lib/photon-server.ts). */
  GEOCODE_URL?: string;
}

/** Cloudflare-Bindings/Vars aus dem Worker-Kontext. Wirft ausserhalb des Workers. */
export async function getBindings(): Promise<AppBindings> {
  const { env } = await getCloudflareContext({ async: true });
  return env as unknown as AppBindings;
}

/** Umgebungsname (production | preview | development) fuer R2-Key-Praefixe u. Ae. */
export async function getEnvironment(): Promise<string> {
  try {
    return (await getBindings()).ENVIRONMENT ?? "development";
  } catch {
    return "development";
  }
}

/**
 * Fuehrt eine Funktion mit einer frischen Drizzle-Verbindung aus und schliesst
 * sie danach zuverlaessig. Kurzlebige Verbindung pro Request-Arbeit ist das
 * empfohlene Muster fuer Worker ueber Hyperdrive.
 */
export async function withDb<T>(fn: (db: AppDb) => Promise<T>): Promise<T> {
  const cs = (await getBindings()).HYPERDRIVE?.connectionString;
  if (!cs) throw new Error("HYPERDRIVE-Bindung fehlt");
  const sql = createSql(cs);
  const db = drizzle(sql, { schema });
  try {
    return await fn(db);
  } finally {
    await sql.end().catch(() => {});
  }
}

/** Beleg-Bucket aus der R2-Bindung. */
export async function getBelegeBucket(): Promise<BelegeBucket> {
  const bucket = (await getBindings()).BELEGE;
  if (!bucket) throw new Error("BELEGE-R2-Bindung fehlt");
  return bucket;
}

/**
 * Von der Middleware verifizierte E-Mail. `null`, wenn kein autoritativer Header
 * gesetzt ist – Aufrufer weisen den Request dann ab (fail closed).
 */
export async function currentUserEmail(): Promise<string | null> {
  return (await headers()).get(ACCESS_EMAIL_HEADER);
}
