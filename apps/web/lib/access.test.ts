import { describe, expect, it } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  type JWK,
} from "jose";

import { getAccessConfig, resolveDevBypass, verifyAccessToken } from "./access";

const ISSUER = "https://bhyo.cloudflareaccess.com";
const AUDIENCE = "test-aud-tag";
const KID = "test-key-1";

/** Erzeugt ein Schlüsselpaar samt lokalem JWKS-Resolver für den Test. */
async function makeKey(kid = KID) {
  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  const jwks: JSONWebKeySet = { keys: [jwk] };
  return { privateKey, keyResolver: createLocalJWKSet(jwks) };
}

/** Signiert ein Access-artiges Token mit sinnvollen Defaults. */
async function signToken(
  privateKey: CryptoKey,
  {
    email = "eric.schmitt@bhyo.de",
    omitEmail = false,
    issuer = ISSUER,
    audience = AUDIENCE,
    expiresInSeconds = 3600,
    kid = KID,
  }: {
    email?: string;
    omitEmail?: boolean;
    issuer?: string;
    audience?: string;
    expiresInSeconds?: number;
    kid?: string;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {};
  if (!omitEmail) payload.email = email;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuedAt(now)
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(now + expiresInSeconds)
    .sign(privateKey);
}

describe("verifyAccessToken", () => {
  it("gibt die E-Mail eines gültigen Tokens zurück", async () => {
    const { privateKey, keyResolver } = await makeKey();
    const token = await signToken(privateKey, { email: "eric.schmitt@bhyo.de" });

    const identity = await verifyAccessToken(token, {
      keyResolver,
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    expect(identity.email).toBe("eric.schmitt@bhyo.de");
  });

  it("weist ein abgelaufenes Token ab", async () => {
    const { privateKey, keyResolver } = await makeKey();
    const token = await signToken(privateKey, { expiresInSeconds: -60 });

    await expect(
      verifyAccessToken(token, { keyResolver, issuer: ISSUER, audience: AUDIENCE }),
    ).rejects.toThrow();
  });

  it("weist ein mit fremdem Schlüssel signiertes (manipuliertes) Token ab", async () => {
    // Token wird mit einem anderen Schlüssel signiert, als der Resolver kennt.
    const attacker = await makeKey();
    const trusted = await makeKey();
    const forged = await signToken(attacker.privateKey);

    await expect(
      verifyAccessToken(forged, {
        keyResolver: trusted.keyResolver,
        issuer: ISSUER,
        audience: AUDIENCE,
      }),
    ).rejects.toThrow();
  });

  it("weist ein Token mit falschem aud ab", async () => {
    const { privateKey, keyResolver } = await makeKey();
    const token = await signToken(privateKey, { audience: "anderes-aud" });

    await expect(
      verifyAccessToken(token, { keyResolver, issuer: ISSUER, audience: AUDIENCE }),
    ).rejects.toThrow();
  });

  it("weist ein Token ohne E-Mail-Claim ab", async () => {
    const { privateKey, keyResolver } = await makeKey();
    const token = await signToken(privateKey, { omitEmail: true });

    await expect(
      verifyAccessToken(token, { keyResolver, issuer: ISSUER, audience: AUDIENCE }),
    ).rejects.toThrow();
  });
});

describe("resolveDevBypass", () => {
  it("liefert die Dev-E-Mail, wenn Flag gesetzt und NODE_ENV nicht production", () => {
    const result = resolveDevBypass({
      nodeEnv: "development",
      bypassFlag: "true",
      devEmail: "dev@bhyo.de",
    });
    expect(result).toEqual({ email: "dev@bhyo.de" });
  });

  it("greift in Production niemals, auch wenn das Flag gesetzt ist", () => {
    const result = resolveDevBypass({
      nodeEnv: "production",
      bypassFlag: "true",
      devEmail: "dev@bhyo.de",
    });
    expect(result).toBeNull();
  });

  it("ist ohne gesetztes Flag inaktiv", () => {
    const result = resolveDevBypass({
      nodeEnv: "development",
      bypassFlag: undefined,
      devEmail: "dev@bhyo.de",
    });
    expect(result).toBeNull();
  });
});

describe("getAccessConfig", () => {
  it("leitet Issuer und JWKS-URL aus der Team-Domain ab", () => {
    const config = getAccessConfig({
      ACCESS_TEAM_DOMAIN: "bhyo.cloudflareaccess.com",
      ACCESS_AUD: "aud-tag",
    });
    expect(config.issuer).toBe("https://bhyo.cloudflareaccess.com");
    expect(config.jwksUrl).toBe(
      "https://bhyo.cloudflareaccess.com/cdn-cgi/access/certs",
    );
    expect(config.audience).toBe("aud-tag");
  });

  it("schlägt fehl, wenn ACCESS_AUD fehlt (fail closed)", () => {
    expect(() => getAccessConfig({ ACCESS_TEAM_DOMAIN: "bhyo.cloudflareaccess.com" }))
      .toThrow();
  });
});
