import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { getCloudflareContext } from "@opennextjs/cloudflare";

import {
  ACCESS_EMAIL_HEADER,
  getAccessConfig,
  resolveDevBypass,
  verifyAccessToken,
} from "@/lib/access";

// JWKS-Resolver pro URL im Modul-Scope halten: jose cached die Schlüssel intern
// (mit Cooldown) und holt sie nur bei unbekanntem `kid` neu.
const jwksResolvers = new Map<string, JWTVerifyGetKey>();
function jwksFor(url: string): JWTVerifyGetKey {
  let resolver = jwksResolvers.get(url);
  if (!resolver) {
    resolver = createRemoteJWKSet(new URL(url));
    jwksResolvers.set(url, resolver);
  }
  return resolver;
}

/** Cloudflare-Bindings/Vars lesen; außerhalb des Worker-Kontexts leeres Objekt. */
async function cloudflareVars(): Promise<Record<string, string | undefined>> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return env as unknown as Record<string, string | undefined>;
  } catch {
    return {};
  }
}

async function resolveEmail(req: NextRequest): Promise<string | null> {
  const cf = await cloudflareVars();
  const get = (key: string) => cf[key] ?? process.env[key];

  // Lokaler Bypass. NODE_ENV kommt bewusst aus process.env (zur Buildzeit
  // inlined) — in Production ist der Zweig toter Code und kann nie greifen.
  const bypass = resolveDevBypass({
    nodeEnv: process.env.NODE_ENV,
    bypassFlag: get("DEV_AUTH_BYPASS"),
    devEmail: get("DEV_AUTH_EMAIL"),
  });
  if (bypass) return bypass.email;

  const token =
    req.headers.get("cf-access-jwt-assertion") ??
    req.cookies.get("CF_Authorization")?.value ??
    null;
  if (!token) return null;

  try {
    const config = getAccessConfig({
      ACCESS_TEAM_DOMAIN: get("ACCESS_TEAM_DOMAIN"),
      ACCESS_AUD: get("ACCESS_AUD"),
    });
    const { email } = await verifyAccessToken(token, {
      keyResolver: jwksFor(config.jwksUrl),
      issuer: config.issuer,
      audience: config.audience,
    });
    return email;
  } catch {
    // Ungültige Signatur, falsches aud/iss, abgelaufen oder Config fehlt: fail closed.
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  // Einem eingehenden Identitäts-Header nie vertrauen.
  requestHeaders.delete(ACCESS_EMAIL_HEADER);

  const email = await resolveEmail(req);
  if (email) requestHeaders.set(ACCESS_EMAIL_HEADER, email);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  // Auf alle Routen außer Next-Interna/statische Assets anwenden.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
