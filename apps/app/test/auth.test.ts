import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyAccessToken } from "../src/server/access-tokens";
import { verifyApiKey } from "../src/server/api-key-store";
import { createAuth, SESSION_COOKIE, socialProviders, type AuthBindings } from "../src/server/auth";
import {
  describeConsent,
  disconnectClient,
  listConnectedClients,
} from "../src/server/connected-clients";
import { mexicoDay, readUsage, recordUsage } from "../src/server/usage";

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
  MCP_RESOURCE: `${ORIGIN}/mcp`,
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

describe("MCP authorization", () => {
  const RESOURCE = `${ORIGIN}/mcp`;
  const CLIENT_ID = "https://client.example/oauth/metadata.json";
  const REDIRECT_URI = "https://client.example/callback";
  const metadataDocument = {
    client_id: CLIENT_ID,
    client_name: "Example MCP client",
    client_uri: "https://client.example",
    redirect_uris: [REDIRECT_URI],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  beforeEach(() => {
    // The client's metadata document, as `cimd()` fetches it through the Worker's `fetch`.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== CLIENT_ID) throw new Error(`unexpected fetch ${url}`);
      return Response.json(metadataDocument, { headers: { "cache-control": "max-age=60" } });
    });
  });
  afterEach(() => vi.restoreAllMocks());

  async function pkce() {
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/gu, "-")
      .replace(/\//gu, "_")
      .replace(/=+$/u, "");
    return { verifier, challenge };
  }

  function authorizeUrl(challenge: string, clientId = CLIENT_ID, redirectUri = REDIRECT_URI) {
    const url = new URL(`${ORIGIN}/api/auth/oauth2/authorize`);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "codice:read offline_access",
      state: "state-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: RESOURCE,
    }).toString();
    return url;
  }

  function token(body: Record<string, string>) {
    return auth.handler(
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body),
      }),
    );
  }

  /** Authorizes the client as a signed-in user and redeems the code: the token response. */
  async function connect(cookie: string, clientId = CLIENT_ID, redirectUri = REDIRECT_URI) {
    const { verifier, challenge } = await pkce();
    const authorize = await auth.handler(
      new Request(authorizeUrl(challenge, clientId, redirectUri), { headers: { cookie } }),
    );
    expect(authorize.status).toBe(302);
    const consentPage = new URL(authorize.headers.get("location")!, ORIGIN);
    expect(consentPage.pathname).toBe("/consent");

    const consent = await post(
      "/oauth2/consent",
      { accept: true, oauth_query: consentPage.search.slice(1) },
      { cookie },
    );
    expect(consent.status).toBe(200);
    const { url } = (await consent.json()) as { url: string };
    const callback = new URL(url);
    expect(`${callback.origin}${callback.pathname}`).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("state-1");
    expect(callback.searchParams.get("iss")).toBe(`${ORIGIN}/api/auth`);

    const response = await token({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      scope: string;
      token_type: string;
    };
  }

  it("publishes authorization server metadata for MCP clients at the root", async () => {
    const response = await auth.handler(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      issuer: `${ORIGIN}/api/auth`,
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      scopes_supported: ["codice:read", "offline_access"],
    });
  });

  it("sends a signed-out user to /login, and signing in resumes at /consent", async () => {
    const { challenge } = await pkce();
    const authorize = await auth.handler(new Request(authorizeUrl(challenge)));
    expect(authorize.status).toBe(302);
    const login = new URL(authorize.headers.get("location")!, ORIGIN);
    expect(login.pathname).toBe("/login");

    const email = "resume@example.com";
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    const otp = /\b(\d{6})\b/u.exec(sent.at(-1)?.text ?? "")?.[1];
    const signIn = await post("/sign-in/email-otp", {
      email,
      otp,
      oauth_query: login.search.slice(1),
    });

    expect(signIn.status).toBe(200);
    const next = (await signIn.json()) as { redirect: boolean; url: string };
    expect(next.redirect).toBe(true);
    expect(new URL(next.url, ORIGIN).pathname).toBe("/consent");
  });

  it("shows the consent page the client, its scopes and where it returns", async () => {
    const { cookie } = await signIn("consent@example.com");
    const { challenge } = await pkce();
    const authorize = await auth.handler(
      new Request(authorizeUrl(challenge), { headers: { cookie } }),
    );
    const search = new URL(authorize.headers.get("location")!, ORIGIN).search;
    const headers = new Headers({ cookie });

    expect(await describeConsent(bindings, headers, search)).toEqual({
      client: {
        clientId: CLIENT_ID,
        name: "Example MCP client",
        uri: "https://client.example",
        icon: null,
      },
      scopes: ["codice:read", "offline_access"],
      redirectHost: "client.example",
      loopback: false,
    });
    const forged = search.replace("state-1", "state-2");
    expect(await describeConsent(bindings, headers, forged)).toBeNull();
  });

  it("issues a JWT for the /mcp resource that CodiceAccounts verifies, and a refresh token", async () => {
    const { cookie } = await signIn("connect@example.com");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    const tokens = await connect(cookie);

    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.scope).toBe("codice:read offline_access");
    expect(tokens.refresh_token).toBeTruthy();
    expect(await verifyAccessToken(bindings, tokens.access_token)).toEqual({
      valid: true,
      userId: session!.user.id,
      clientId: CLIENT_ID,
      scopes: ["codice:read", "offline_access"],
    });

    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token!,
      client_id: CLIENT_ID,
      resource: RESOURCE,
    });
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect(await verifyAccessToken(bindings, next.access_token)).toMatchObject({ valid: true });
  });

  it("refuses a token for another resource, a tampered one, and an API key", async () => {
    const { cookie } = await signIn("audience@example.com");
    const { access_token } = await connect(cookie);
    const [header, payload, signature] = access_token.split(".");
    const tampered = `${header}.${payload}.${signature!.slice(0, -4)}AAAA`;

    expect(
      await verifyAccessToken(
        { ...bindings, MCP_RESOURCE: "https://other.example/mcp" },
        access_token,
      ),
    ).toEqual({ valid: false });
    expect(await verifyAccessToken(bindings, tampered)).toEqual({ valid: false });
    expect(await verifyAccessToken(bindings, "cdc_not_a_jwt")).toEqual({ valid: false });
  });

  it("lists the connected client, and disconnecting it ends its access", async () => {
    const { cookie } = await signIn("disconnect@example.com");
    const headers = new Headers({ cookie });
    const tokens = await connect(cookie);

    const [connected] = await listConnectedClients(bindings, headers);
    expect(connected).toMatchObject({
      clientId: CLIENT_ID,
      name: "Example MCP client",
      uri: "https://client.example",
      scopes: ["codice:read", "offline_access"],
    });
    expect(connected!.lastActiveAt).toMatch(/^\d{4}-/u);

    await disconnectClient(bindings, headers, CLIENT_ID);

    expect(await listConnectedClients(bindings, headers)).toEqual([]);
    expect(await verifyAccessToken(bindings, tokens.access_token)).toEqual({ valid: false });
    const refreshed = await token({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token!,
      client_id: CLIENT_ID,
    });
    expect(refreshed.status).toBe(400);
  });

  it("still registers a public client by Dynamic Client Registration", async () => {
    const registered = await post("/oauth2/register", {
      client_name: "Legacy MCP client",
      // A loopback redirect is a native app's (MCP 2026-07-28, "Dynamic Client Registration").
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:33418/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    expect(registered.status).toBe(201);
    const { client_id } = (await registered.json()) as { client_id: string };

    const { cookie } = await signIn("dcr@example.com");
    const tokens = await connect(cookie, client_id, "http://127.0.0.1:33418/callback");

    expect(await verifyAccessToken(bindings, tokens.access_token)).toMatchObject({
      valid: true,
      clientId: client_id,
    });
  });
});

describe("usage", () => {
  it("counts reported calls per day and reads the team's keys and its members' clients", async () => {
    const { cookie } = await signIn("usage@example.com");
    const headers = new Headers({ cookie, origin: ORIGIN });
    const [team] = await auth.api.listOrganizations({ headers });
    const session = await auth.api.getSession({ headers });
    const userId = session!.user.id;
    const key = await auth.api.createApiKey({
      headers,
      body: { organizationId: team!.id, name: "producción" },
    });
    const now = Date.now();
    const lastWeek = now - 7 * 24 * 60 * 60 * 1000;
    const byKey = { kind: "api_key" as const, keyId: key.id, organizationId: team!.id };
    const byClient = { kind: "oauth" as const, userId, clientId: "https://client.test/a" };
    const call = { surface: "http" as const, durationMs: 100, at: now };

    await recordUsage(env.ACCOUNTS_DATABASE, [
      { ...call, caller: byKey, operation: "search", status: 200 },
      { ...call, caller: byKey, operation: "search", status: 200, durationMs: 300 },
      { ...call, caller: byKey, operation: "lookup_error", status: 404 },
      { ...call, caller: byKey, operation: "search", status: 200, at: lastWeek },
      { ...call, caller: byClient, surface: "mcp", operation: "search", status: 200 },
      // Another team's key and someone outside the team stay out of this team's page.
      {
        ...call,
        caller: { ...byKey, organizationId: "other-team" },
        operation: "search",
        status: 200,
      },
      {
        ...call,
        caller: { ...byClient, userId: "someone-else" },
        surface: "mcp",
        operation: "search",
        status: 200,
      },
    ]);

    const usage = await readUsage(bindings, headers, { organizationId: team!.id });

    expect(usage.days).toBe(7);
    expect(usage.end).toBe(mexicoDay(now));
    expect(usage.keys.days).toHaveLength(7);
    expect(usage.keys.days.at(-1)?.requests).toEqual({ [`api_key:${key.id}`]: 3 });
    expect(usage.keys.series).toEqual([
      {
        id: `api_key:${key.id}`,
        label: "producción",
        hint: key.start,
        image: null,
        requests: 3,
        previous: 1,
      },
    ]);
    expect(usage.keys.operations).toEqual([
      { operation: "search", requests: 2, errors: 0, previous: 1 },
      { operation: "lookup_error", requests: 1, errors: 1, previous: 0 },
    ]);
    expect(usage.keys.totals).toEqual({ requests: 3, errors: 1, meanMs: 167 });
    expect(usage.keys.previous).toEqual({ requests: 1, errors: 0, meanMs: 100 });
    expect(usage.members.series).toEqual([
      {
        id: `member:${userId}`,
        // Signed in by email code with no name yet: the email stands in.
        label: "usage@example.com",
        hint: null,
        image: null,
        requests: 1,
        previous: 0,
      },
    ]);

    const month = await readUsage(bindings, headers, { organizationId: team!.id, days: 30 });
    expect(month.keys.days).toHaveLength(30);
    expect(month.keys.totals.requests).toBe(4);
    await expect(readUsage(bindings, headers, { organizationId: "other-team" })).rejects.toThrow();
  });
});
