import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { and, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema";
import { revokeAccessTokens } from "./access-tokens";
import { createAuth, type AuthBindings } from "./auth";

/**
 * The MCP clients a user has authorized (their OAuth consents), what the consent page shows
 * before one is authorized, and disconnecting one. apps/api/SPEC.md, "MCP authorization".
 */

export interface ConnectedClient {
  /** The client's id: for a Client ID Metadata Document client, its metadata URL. */
  clientId: string;
  name: string;
  uri: string | null;
  icon: string | null;
  scopes: string[];
  connectedAt: string;
  /** When it last got a token (a sign-in or a refresh), to the refresh: about hourly in use. */
  lastActiveAt: string | null;
}

/**
 * A JSON column Better Auth wrote: through Drizzle's `json` mode it reads back as the JSON text,
 * since the adapter stores it already serialized.
 */
function stringArray(value: unknown): string[] {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
}

async function signedInUser(env: AuthBindings, headers: Headers) {
  const session = await createAuth(env).api.getSession({ headers });
  if (!session) throw new Error("Not signed in");
  return session.user;
}

export async function listConnectedClients(
  env: AuthBindings,
  headers: Headers,
): Promise<ConnectedClient[]> {
  const user = await signedInUser(env, headers);
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });
  const [consents, activity] = await Promise.all([
    db
      .select({
        clientId: schema.oauthConsent.clientId,
        scopes: schema.oauthConsent.scopes,
        connectedAt: schema.oauthConsent.createdAt,
        name: schema.oauthClient.name,
        uri: schema.oauthClient.uri,
        icon: schema.oauthClient.icon,
      })
      .from(schema.oauthConsent)
      .innerJoin(schema.oauthClient, eq(schema.oauthClient.clientId, schema.oauthConsent.clientId))
      .where(eq(schema.oauthConsent.userId, user.id))
      .orderBy(schema.oauthConsent.createdAt),
    db
      .select({
        clientId: schema.oauthRefreshToken.clientId,
        at: max(schema.oauthRefreshToken.createdAt),
      })
      .from(schema.oauthRefreshToken)
      .where(eq(schema.oauthRefreshToken.userId, user.id))
      .groupBy(schema.oauthRefreshToken.clientId),
  ]);
  const lastActive = new Map(activity.map((row) => [row.clientId, row.at]));
  return consents.map((consent) => {
    const at = lastActive.get(consent.clientId);
    return {
      clientId: consent.clientId,
      name: consent.name || consent.clientId,
      uri: consent.uri,
      icon: consent.icon,
      scopes: stringArray(consent.scopes),
      connectedAt: consent.connectedAt.toISOString(),
      lastActiveAt: at ? new Date(at).toISOString() : null,
    };
  });
}

/**
 * Disconnects a client: its consent and refresh tokens go, so it cannot get a new token without
 * the user's consent again, and the access tokens it holds stop verifying within a minute.
 */
export async function disconnectClient(env: AuthBindings, headers: Headers, clientId: string) {
  const user = await signedInUser(env, headers);
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });
  await db.batch([
    db
      .delete(schema.oauthConsent)
      .where(
        and(eq(schema.oauthConsent.userId, user.id), eq(schema.oauthConsent.clientId, clientId)),
      ),
    db
      .delete(schema.oauthRefreshToken)
      .where(
        and(
          eq(schema.oauthRefreshToken.userId, user.id),
          eq(schema.oauthRefreshToken.clientId, clientId),
        ),
      ),
    db
      .delete(schema.oauthAccessToken)
      .where(
        and(
          eq(schema.oauthAccessToken.userId, user.id),
          eq(schema.oauthAccessToken.clientId, clientId),
        ),
      ),
  ]);
  await revokeAccessTokens(env.API_KEYS, clientId, user.id);
}

export interface ConsentRequest {
  client: { clientId: string; name: string; uri: string | null; icon: string | null };
  scopes: string[];
  /** The host the authorization goes back to: MCP 2026-07-28 says to show it. */
  redirectHost: string;
  /** Only a loopback redirect: any program on the user's machine could be that client. */
  loopback: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The authorization the consent page was sent to approve, from its signed query (the
 * `ba_param` names list which parameters are signed), or `null` for a forged or expired one.
 */
export async function describeConsent(
  env: AuthBindings,
  headers: Headers,
  search: string,
): Promise<ConsentRequest | null> {
  const params = new URLSearchParams(search);
  const signedNames = new Set(params.getAll("ba_param"));
  const signed = new URLSearchParams();
  for (const [key, value] of params) {
    if (key === "sig" || key === "ba_param" || signedNames.has(key)) signed.append(key, value);
  }
  const auth = createAuth(env);
  const { secret } = await auth.$context;
  if (!(await verifyOAuthQueryParams(signed.toString(), secret))) return null;

  const clientId = signed.get("client_id");
  if (!clientId) return null;
  const client = await auth.api.getOAuthClientPublic({ query: { client_id: clientId }, headers });
  const redirect = new URL(signed.get("redirect_uri") ?? client.redirect_uris?.[0] ?? "");
  return {
    client: {
      clientId,
      name: client.client_name || clientId,
      uri: client.client_uri ?? null,
      icon: client.logo_uri ?? null,
    },
    scopes: (signed.get("scope") ?? "").split(" ").filter(Boolean),
    redirectHost: redirect.host,
    loopback: LOOPBACK_HOSTS.has(redirect.hostname),
  };
}
