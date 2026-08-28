import { jwtVerify, type JWTVerifyGetKey } from "jose";

// Autoritativer Träger der verifizierten Identität zwischen Middleware und Routen.
export const ACCESS_EMAIL_HEADER = "x-access-email";

export interface AccessIdentity {
  email: string;
}

/**
 * Verifiziert ein Cloudflare-Access-JWT: Signatur gegen den JWKS-Resolver sowie
 * Issuer, Audience und Ablauf. Wirft bei jedem Fehler — der Aufrufer entscheidet
 * daraus über 403. Reine Funktion ohne Netz-/Umgebungszugriff: Der Resolver wird
 * injiziert, damit sich die Prüfung ohne Cloudflare testen lässt.
 */
export async function verifyAccessToken(
  token: string,
  opts: { keyResolver: JWTVerifyGetKey; issuer: string; audience: string },
): Promise<AccessIdentity> {
  const { payload } = await jwtVerify(token, opts.keyResolver, {
    issuer: opts.issuer,
    audience: opts.audience,
  });

  const email = typeof payload.email === "string" ? payload.email : undefined;
  if (!email) {
    throw new Error("Access-Token ohne E-Mail-Claim");
  }

  return { email };
}

export interface AccessConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

/**
 * Leitet die Prüfparameter aus den Umgebungsvariablen ab. Ohne `ACCESS_AUD`
 * schlägt der Aufbau bewusst fehl (fail closed): Ein Token ohne definierte
 * erwartete Audience darf nicht als gültig durchgehen.
 */
export function getAccessConfig(env: {
  ACCESS_TEAM_DOMAIN?: string | undefined;
  ACCESS_AUD?: string | undefined;
}): AccessConfig {
  const teamDomain = env.ACCESS_TEAM_DOMAIN ?? "bhyo.cloudflareaccess.com";
  const audience = env.ACCESS_AUD;
  if (!audience) {
    throw new Error("ACCESS_AUD ist nicht konfiguriert");
  }
  return {
    issuer: `https://${teamDomain}`,
    audience,
    jwksUrl: `https://${teamDomain}/cdn-cgi/access/certs`,
  };
}

/**
 * Entscheidet, ob die Access-Prüfung lokal umgangen wird. Der Bypass greift nur,
 * wenn NODE_ENV nicht "production" ist — im gebauten Worker inlined Next
 * NODE_ENV="production", die Bedingung ist dort also toter Code. Selbst ein
 * versehentlich in Production gesetztes Flag kann die Prüfung damit nie abschalten.
 */
export function resolveDevBypass(env: {
  nodeEnv: string | undefined;
  bypassFlag: string | undefined;
  devEmail: string | undefined;
}): { email: string } | null {
  if (env.nodeEnv === "production") return null;
  if (env.bypassFlag !== "true") return null;
  return { email: env.devEmail ?? "dev@bhyo.de" };
}
