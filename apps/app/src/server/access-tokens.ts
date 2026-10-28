import {
  createLocalJWKSet,
  errors,
  jwtVerify,
  type FlattenedJWSInput,
  type JSONWebKeySet,
  type JWSHeaderParameters,
} from "jose";

import type { AccessTokenVerification } from "@codice/contracts";

import { ACCESS_TOKEN_TTL_SECONDS, createAuth, oauthIssuer, type AuthBindings } from "./auth";

/**
 * MCP access tokens are JWTs `mcp()` signs with the `jwt()` plugin's keys (`jwks` in D1).
 * `verifyAccessToken` runs on every `/mcp` call, so it reads the public keys from D1 once per
 * isolate and again only for a key it has not seen (a rotation) or after `KEYS_TTL_MS`; the
 * rest is the token itself and one KV read for a disconnect.
 */
const KEYS_TTL_MS = 10 * 60_000;
/** The least time between two reloads for an unknown key id, so forged ids cannot hammer D1. */
const KEYS_RELOAD_MIN_MS = 30_000;

let cachedKeys: {
  set: ReturnType<typeof createLocalJWKSet>;
  kids: Set<string>;
  at: number;
} | null = null;

async function signingKeys(env: AuthBindings, kid: string | undefined) {
  const now = Date.now();
  const stale = !cachedKeys || now - cachedKeys.at > KEYS_TTL_MS;
  const unknown = kid !== undefined && !cachedKeys?.kids.has(kid);
  if (stale || (unknown && now - cachedKeys!.at > KEYS_RELOAD_MIN_MS)) {
    const jwks = (await createAuth(env).api.getJwks()) as JSONWebKeySet;
    cachedKeys = {
      set: createLocalJWKSet(jwks),
      kids: new Set(jwks.keys.map((key) => key.kid).filter((id) => id !== undefined)),
      at: now,
    };
  }
  return cachedKeys!.set;
}

const REVOKED_PREFIX = "codice:oauth-revoked:";

/**
 * Marks every access token the user's grant to the client holds as revoked: a JWT cannot be
 * recalled, so `verifyAccessToken` refuses one issued at or before this moment. The marker
 * outlives the last such token by a minute (KV keeps a read for 60 seconds at each location).
 */
export function revokeAccessTokens(kv: KVNamespace, clientId: string, userId: string) {
  return kv.put(`${REVOKED_PREFIX}${clientId}:${userId}`, String(Math.floor(Date.now() / 1000)), {
    expirationTtl: ACCESS_TOKEN_TTL_SECONDS + 120,
  });
}

const INVALID: AccessTokenVerification = { valid: false };

export async function verifyAccessToken(
  env: AuthBindings,
  token: unknown,
): Promise<AccessTokenVerification> {
  // A compact JWS is three base64url parts; anything else is not one of these tokens.
  if (typeof token !== "string" || token.length > 4096 || token.split(".").length !== 3) {
    return INVALID;
  }
  let payload;
  try {
    const getKey = async (
      header: JWSHeaderParameters,
      jws: FlattenedJWSInput,
    ): Promise<CryptoKey> => (await signingKeys(env, header.kid))(header, jws);
    ({ payload } = await jwtVerify(token, getKey, {
      issuer: oauthIssuer(env),
      audience: env.MCP_RESOURCE,
      typ: "at+jwt",
      requiredClaims: ["sub", "azp", "iat", "exp"],
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError) return INVALID;
    throw error;
  }
  const { sub, azp, iat, scope, cnf } = payload as Record<string, unknown>;
  // A DPoP-bound token (`cnf`) is valid only with its proof, which `/mcp` does not check.
  if (typeof sub !== "string" || typeof azp !== "string" || typeof iat !== "number" || cnf) {
    return INVALID;
  }
  const revokedAt = await env.API_KEYS.get(`${REVOKED_PREFIX}${azp}:${sub}`);
  if (revokedAt !== null && iat <= Number(revokedAt)) return INVALID;
  return {
    valid: true,
    userId: sub,
    clientId: azp,
    scopes: typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
  };
}
