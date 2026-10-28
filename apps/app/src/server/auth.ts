import { apiKey } from "@better-auth/api-key";
import { cimd } from "@better-auth/cimd";
import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, jwt, organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema";
import { API_KEY_PREFIX, kvStorage } from "./api-key-store";
import { fetchClientMetadataResource } from "./client-metadata-fetch";
import { ac, managesTeam, roles } from "./permissions";

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

/** How long an invitation to a team stays open. */
export const INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Where an invitation's email leads: the dashboard's page to accept or decline it. */
export function invitationUrl(env: Pick<AuthBindings, "BETTER_AUTH_URL">, invitationId: string) {
  return `${env.BETTER_AUTH_URL.replace(/\/$/u, "")}/invitacion/${encodeURIComponent(invitationId)}`;
}

/** Who created a team key, in the key's metadata; `verifyApiKey` hands it to usage. */
export interface ApiKeyMetadata {
  createdBy: string;
}

/** The edge treats this cookie as a session (`apps/edge/src/route.ts`, `SESSION_COOKIE`). */
export const SESSION_COOKIE = "__Secure-codice-session";

/**
 * Better Auth for the dashboard: users, sessions and teams in D1 (`codice-accounts`), API keys in
 * KV (`API_KEYS`). A team is a Better Auth organization with owners, admins and members
 * (`permissions.ts`); each new user gets a personal one, and others join by invitation. The team
 * owns its keys, and each key records the member who created it. Built per request: the bindings
 * are per request on Workers.
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A key always names its creator, whatever the request sent: usage is attributed by it.
        if (ctx.path === "/api-key/create") {
          const session = await getSessionFromCtx(ctx);
          if (!session) return;
          const metadata: ApiKeyMetadata = { createdBy: session.user.id };
          return { context: { body: { ...ctx.body, metadata } } };
        }
        // The creator stays as it was set; nothing in the dashboard edits a key.
        if (ctx.path === "/api-key/update" && ctx.body?.metadata !== undefined) {
          throw new APIError("FORBIDDEN", { message: "A key's metadata is not editable" });
        }
        // Members may delete keys (`permissions.ts`), but only the ones they created.
        if (ctx.path === "/api-key/delete") {
          const session = await getSessionFromCtx(ctx);
          if (!session) return;
          const key = await auth.api
            .getApiKey({ headers: ctx.headers ?? new Headers(), query: { id: ctx.body?.keyId } })
            .catch(() => null);
          if (!key) return;
          const membership = await db
            .select({ role: schema.member.role })
            .from(schema.member)
            .where(
              and(
                eq(schema.member.organizationId, key.referenceId),
                eq(schema.member.userId, session.user.id),
              ),
            )
            .get();
          if (!membership || managesTeam(membership.role)) return;
          const creator = (key.metadata as Partial<ApiKeyMetadata> | null)?.createdBy;
          if (creator !== session.user.id) {
            throw new APIError("FORBIDDEN", {
              message: "Only its creator or an admin revokes a key",
            });
          }
        }
      }),
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
      organization({
        ac,
        roles,
        invitationExpiresIn: INVITATION_TTL_SECONDS,
        // Inviting the same email again replaces the open invitation instead of adding one.
        cancelPendingInvitationsOnReInvite: true,
        async sendInvitationEmail({ id, email, organization, inviter }) {
          const from = inviter.user.name?.trim() || inviter.user.email;
          await env.EMAIL.send({
            from: { name: "Códice", email: env.AUTH_EMAIL_FROM },
            to: email,
            subject: `${from} te invitó a ${organization.name} en Códice`,
            text: `${from} te invitó a unirte a ${organization.name} en Códice.\n\nAcepta la invitación aquí: ${invitationUrl(env, id)}\n\nVence en 7 días. Si no la esperabas, ignora este correo.`,
          });
        },
      }),
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
        // Holds `{ createdBy }`, which the `/api-key/create` hook sets.
        enableMetadata: true,
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
