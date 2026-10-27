import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { verifyApiKey } from "../src/server/api-key-store";
import { createAuth, SESSION_COOKIE, socialProviders, type AuthBindings } from "../src/server/auth";

/**
 * Better Auth's wiring against a local D1 and KV: sign-in by email code, the personal team, and a
 * team key created by the api-key plugin and read back by `verifyApiKey` (what `CodiceAccounts`
 * answers `codice-api`). Google and GitHub need their real OAuth apps and are not exercised.
 */
const ORIGIN = "https://codice.io";
const sent: { to: unknown; subject: string; text?: string }[] = [];

const bindings: AuthBindings = {
  ACCOUNTS_DATABASE: env.ACCOUNTS_DATABASE,
  API_KEYS: env.API_KEYS,
  EMAIL: {
    async send(message: { to: unknown; subject: string; text?: string }) {
      sent.push(message);
      return { messageId: `test-${sent.length}` };
    },
  } as unknown as SendEmail,
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
  AUTH_EMAIL_FROM: "acceso@codice.io",
  GOOGLE_CLIENT_ID: "google-test",
  GOOGLE_CLIENT_SECRET: "google-test",
  GITHUB_CLIENT_ID: "github-test",
  GITHUB_CLIENT_SECRET: "github-test",
};
const auth = createAuth(bindings);

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/** Signs in by email code; the session cookie, as a `cookie` header. */
async function signIn(email: string) {
  const request = await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
  expect(request.status).toBe(200);
  const otp = /\b(\d{6})\b/u.exec(sent.at(-1)?.text ?? "")?.[1];
  expect(otp).toBeDefined();

  const response = await post("/sign-in/email-otp", { email, otp });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  expect(cookie).toBeDefined();
  return { cookie: cookie!.split(";")[0]!, setCookie: cookie! };
}

const noWaitUntil = () => {};

beforeAll(async () => {
  await applyD1Migrations(env.ACCOUNTS_DATABASE, env.TEST_MIGRATIONS);
});

describe("sign-in by email code", () => {
  it("emails a six-digit code from the configured sender", async () => {
    await post("/email-otp/send-verification-otp", { email: "ana@example.com", type: "sign-in" });

    expect(sent.at(-1)).toMatchObject({
      from: { name: "Códice", email: "acceso@codice.io" },
      to: "ana@example.com",
    });
    expect(sent.at(-1)?.subject).toMatch(/\d{6}/u);
  });

  it("sets the session cookie the edge looks for", async () => {
    const { setCookie } = await signIn("cookie@example.com");

    expect(setCookie).toMatch(/^__Secure-codice-session=/u);
    expect(setCookie).toMatch(/; Secure/iu);
    expect(setCookie).toMatch(/; HttpOnly/iu);
  });

  it("refuses a wrong code", async () => {
    await post("/email-otp/send-verification-otp", { email: "wrong@example.com", type: "sign-in" });
    const response = await post("/sign-in/email-otp", {
      email: "wrong@example.com",
      otp: "000000",
    });

    expect(response.status).toBe(400);
  });
});

describe("social sign-in", () => {
  it("turns a provider on only when both of its secrets are set", () => {
    const { GOOGLE_CLIENT_SECRET: _, ...googleWithoutSecret } = bindings;

    expect(Object.keys(socialProviders(bindings))).toEqual(["google", "github"]);
    expect(Object.keys(socialProviders(googleWithoutSecret))).toEqual(["github"]);
    expect(
      socialProviders({
        ...bindings,
        GOOGLE_CLIENT_ID: undefined,
        GITHUB_CLIENT_ID: "",
      }),
    ).toEqual({});
  });
});

describe("teams", () => {
  it("gives a new user a personal team, active on sign-in", async () => {
    const { cookie } = await signIn("luis@example.com");
    const headers = new Headers({ cookie });

    const teams = await auth.api.listOrganizations({ headers });
    const session = await auth.api.getSession({ headers });

    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ name: "luis (personal)" });
    expect(session?.session.activeOrganizationId).toBe(teams[0]!.id);
  });
});

describe("team API keys", () => {
  async function teamOf(email: string) {
    const { cookie } = await signIn(email);
    const headers = new Headers({ cookie, origin: ORIGIN });
    const [team] = await auth.api.listOrganizations({ headers });
    return { headers, team: team! };
  }

  it("creates a cdc_ key owned by the team, stored hashed in KV only", async () => {
    const { headers, team } = await teamOf("keys@example.com");

    const created = await auth.api.createApiKey({
      headers,
      body: { organizationId: team.id, name: "production" },
    });

    expect(created.key).toMatch(/^cdc_/u);
    expect(created.referenceId).toBe(team.id);
    const stored = await env.API_KEYS.list({ prefix: "api-key:" });
    expect(stored.keys.length).toBeGreaterThan(0);
    for (const { name } of stored.keys) {
      expect(await env.API_KEYS.get(name)).not.toContain(created.key);
    }
    const rows = await env.ACCOUNTS_DATABASE.prepare("select count(*) as n from apikey").first();
    expect(rows).toEqual({ n: 0 });
  });

  it("verifies a live key to its id and team, and records its use", async () => {
    const { headers, team } = await teamOf("verify@example.com");
    const created = await auth.api.createApiKey({
      headers,
      body: { organizationId: team.id, name: "ci" },
    });
    const pending: Promise<unknown>[] = [];

    const verification = await verifyApiKey(env.API_KEYS, created.key, (promise) => {
      pending.push(promise);
    });
    await Promise.all(pending);

    expect(verification).toEqual({ valid: true, keyId: created.id, organizationId: team.id });
    expect(await env.API_KEYS.get(`codice:last-used:${created.id}`)).toMatch(/^\d{4}-/u);
  });

  it("lists the team's keys without their secret", async () => {
    const { headers, team } = await teamOf("list@example.com");
    const created = await auth.api.createApiKey({
      headers,
      body: { organizationId: team.id, name: "staging" },
    });

    const { apiKeys } = await auth.api.listApiKeys({
      headers,
      query: { organizationId: team.id },
    });

    expect(apiKeys.map((key) => key.id)).toEqual([created.id]);
    expect(apiKeys[0]?.start).toMatch(/^cdc_/u);
    expect(JSON.stringify(apiKeys)).not.toContain(created.key);
  });

  it("refuses a revoked key", async () => {
    const { headers, team } = await teamOf("revoke@example.com");
    const created = await auth.api.createApiKey({
      headers,
      body: { organizationId: team.id, name: "old" },
    });

    await auth.api.deleteApiKey({ headers, body: { keyId: created.id } });

    expect(await verifyApiKey(env.API_KEYS, created.key, noWaitUntil)).toEqual({ valid: false });
  });

  it("refuses another team's member", async () => {
    const owner = await teamOf("owner@example.com");
    const other = await teamOf("other@example.com");

    await expect(
      auth.api.createApiKey({
        headers: other.headers,
        body: { organizationId: owner.team.id, name: "intruder" },
      }),
    ).rejects.toThrow();
  });

  it.each([
    ["an unknown key", "cdc_unknown"],
    ["a key without the prefix", "sk_unknown"],
    ["no key", undefined],
  ])("refuses %s", async (_, key) => {
    expect(await verifyApiKey(env.API_KEYS, key, noWaitUntil)).toEqual({ valid: false });
  });
});
