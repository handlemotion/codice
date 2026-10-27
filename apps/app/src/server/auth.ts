import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP, organization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "../db/schema";
import { API_KEY_PREFIX, kvStorage } from "./api-key-store";

/** The bindings Better Auth reads. `CloudflareBindings` satisfies it; tests pass their own. */
export interface AuthBindings {
  ACCOUNTS_DATABASE: D1Database;
  API_KEYS: KVNamespace;
  EMAIL: SendEmail;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  AUTH_EMAIL_FROM: string;
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
