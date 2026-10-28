import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, jwt, organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema";
import { API_KEY_PREFIX, kvStorage } from "./api-key-store";
import { fetchClientMetadataResource } from "./client-metadata-fetch";

/** The bindings Better Auth reads. `CloudflareBindings` satisfies it; tests pass their own. */
export interface AuthBindings {
  ACCOUNTS_DATABASE: D1Database;
  API_KEYS: KVNamespace;
  EMAIL: SendEmail;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  AUTH_EMAIL_FROM: string;
  /** The `/mcp` resource the OAuth tokens are bound to, `<public origin>/mcp`. */
  MCP_RESOURCE: string;
  // Optional: a provider signs in only once both of its secrets are set (AGENTS.md, "Secrets").
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export type SocialProvider = "google" | "github";

/** The social sign-ins whose OAuth app is configured, each with its client id and secret. */
export function socialProviders(env: AuthBindings) {
  const configured: Partial<Record<SocialProvider, { clientId: string; clientSecret: string }>> =
    {};
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    configured.google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    configured.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
  }
  return configured;
}

/** The scope an MCP client needs for `/mcp`, and the one `/mcp`'s challenges name. */
export const MCP_SCOPE = "codice:read";

/** How long an MCP access token lives; a refresh token (`offline_access`) renews it. */
export const ACCESS_TOKEN_TTL_SECONDS = 3600;

/** The authorization server's issuer: Better Auth's base URL, `<origin>/api/auth`. */
export function oauthIssuer(env: Pick<AuthBindings, "BETTER_AUTH_URL">) {
  return `${env.BETTER_AUTH_URL.replace(/\/$/u, "")}/api/auth`;
}

/** The edge treats this cookie as a session (`apps/edge/src/route.ts`, `SESSION_COOKIE`). */
export const SESSION_COOKIE = "__Secure-codice-session";

/**
 * Better Auth for the dashboard: users, sessions and teams in D1 (`codice-accounts`), API keys in
 * KV (`API_KEYS`). A team is a Better Auth organization; each new user gets a personal one, and
 * the team owns its keys. Built per request: the bindings are per request on Workers.
 */
export function createAuth(env: AuthBindings) {
  const db = drizzle(env.ACCOUNTS_DATABASE, { schema });

  const auth = betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    socialProviders: socialProviders(env),
    // The JWT plugin's own `/token` hands a session JWT to the browser; OAuth clients use
    // `/oauth2/token` instead, so it stays off (Better Auth's JWT docs, "OAuth").
    disabledPaths: ["/token"],
    account: { accountLinking: { enabled: true, trustedProviders: ["google", "github"] } },
    advanced: {
      // `__Secure-` + this name is `SESSION_COOKIE`.
      useSecureCookies: true,
      cookies: { session_token: { name: SESSION_COOKIE.replace("__Secure-", "") } },
    },
    databaseHooks: {
      user: {
        create: {
          // A personal team, so a new user can create a key at once.
          after: async (user) => {
            await auth.api.createOrganization({
              body: { name: personalTeamName(user), slug: `personal-${user.id}`, userId: user.id },
            });
          },
        },
      },
      session: {
        create: {
          // Sign-in lands on the user's first team.
          before: async (session) => {
            const [membership] = await db
              .select({ organizationId: schema.member.organizationId })
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .orderBy(asc(schema.member.createdAt))
              .limit(1);
            return {
              data: { ...session, activeOrganizationId: membership?.organizationId ?? null },
            };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          await env.EMAIL.send({
            from: { name: "Códice", email: env.AUTH_EMAIL_FROM },
            to: email,
            subject: `Tu código de acceso a Códice: ${otp}`,
            text: `Tu código de acceso a Códice es ${otp}. Vence en 10 minutos.\n\nSi no lo pediste, ignora este correo.`,
          });
        },
      }),
      organization(),
      // Signs the MCP access tokens (EdDSA); the public keys are at `/api/auth/jwks`.
      jwt({ disableSettingJwtHeader: true }),
      // The OAuth 2.1 authorization server for MCP clients (MCP 2026-07-28, apps/api/SPEC.md,
      // "MCP authorization"): PKCE, tokens bound to the `/mcp` resource, consent on `/consent`.
      mcp({
        loginPage: "/login",
        consentPage: "/consent",
        resource: env.MCP_RESOURCE,
        // `offline_access` is the authorization server's: MCP clients add it to get a refresh
        // token when it is listed here.
        scopes: [MCP_SCOPE, "offline_access"],
        // A user's grant to a client and its renewal; no machine-to-machine clients.
        grantTypes: ["authorization_code", "refresh_token"],
        accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
        // Dynamic Client Registration is deprecated by MCP 2026-07-28 in favour of Client ID
        // Metadata Documents; it stays on, open to anyone as MCP clients need, for the clients
        // that have not moved yet. Every client still needs the user's consent.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        clientRegistrationDefaultScopes: [MCP_SCOPE, "offline_access"],
      }),
      // Client ID Metadata Documents: a client's `client_id` is the HTTPS URL of its metadata.
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      apiKey({
        references: "organization",
        defaultPrefix: API_KEY_PREFIX,
        requireName: true,
        // Only KV holds the keys; `CodiceAccounts.verifyApiKey` reads them without touching D1.
        storage: "secondary-storage",
        customStorage: kvStorage(env.API_KEYS),
        // Better Auth's per-key limit writes the key on every verify; `codice-api` limits per key
        // with its own rate-limit binding instead.
        rateLimit: { enabled: false },
      }),
      // Last, so it sees every Set-Cookie (sign-in through server functions).
      tanstackStartCookies(),
    ],
  });
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;

function personalTeamName(user: { name?: string | null; email: string }): string {
  const name = user.name?.trim() || user.email.split("@")[0];
  return `${name} (personal)`;
}
