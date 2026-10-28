import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  SELF,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type { UsageEvent } from "@codice/contracts";

import type { CodiceBindings } from "../src/env";
import { app } from "../src/index";

const bindings = env as unknown as CodiceBindings;

// `/v1/sources` answers from D1, empty here.
beforeAll(async () => {
  await applyD1Migrations(env.CODICE_DATABASE, env.TEST_MIGRATIONS);
});

function fetchWith(path: string, overrides: Partial<CodiceBindings>, init?: RequestInit) {
  return app.fetch(
    new Request(`https://codice.test${path}`, init),
    { ...bindings, ...overrides },
    createExecutionContext(),
  );
}

describe("liveness", () => {
  it.each(["/", "/health"])("%s reports the service alive", async (path) => {
    const response = await SELF.fetch(`https://codice.test${path}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "codice", status: "ok" });
  });
});

describe("request ids", () => {
  it("reports the request's time in Server-Timing", async () => {
    const response = await app.request("https://codice.test/health", {}, env);

    expect(response.headers.get("server-timing")).toMatch(/^total;dur=\d+\.\d$/u);
  });

  it("returns the caller's x-request-id", async () => {
    const response = await SELF.fetch("https://codice.test/health", {
      headers: { "x-request-id": "caller-request" },
    });

    expect(response.headers.get("x-request-id")).toBe("caller-request");
  });

  it.each([
    ["missing", {}],
    ["blank", { "x-request-id": "  " }],
    ["longer than 128 characters", { "x-request-id": "x".repeat(129) }],
  ])("mints one when the caller's is %s", async (_, headers) => {
    const response = await SELF.fetch("https://codice.test/health", { headers });

    expect(response.headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });

  it("answers an unknown route with a problem document that carries the request id", async () => {
    const response = await SELF.fetch("https://codice.test/unknown", {
      headers: { "x-request-id": "test-request" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("x-request-id")).toBe("test-request");
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Not found",
      status: 404,
      code: "not_found",
      requestId: "test-request",
    });
  });
});

describe("/ready", () => {
  it("reports ready when every binding is present", async () => {
    const response = await SELF.fetch("https://codice.test/ready");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "codice", status: "ready" });
  });

  it.each(["ACCOUNTS", "CODICE_DATABASE", "CODICE_SEARCH", "CODICE_PUBLIC_RATE_LIMITER"] as const)(
    "answers 503 problem+json without %s",
    async (binding) => {
      const response = await fetchWith(
        "/ready",
        { [binding]: undefined },
        { headers: { "x-request-id": "ready-check" } },
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(await response.json()).toEqual({
        type: "about:blank",
        title: "Códice bindings are not ready",
        status: 503,
        code: "codice_bindings_not_ready",
        requestId: "ready-check",
      });
    },
  );
});

describe("API keys", () => {
  // `/mcp` takes the same keys; without one it answers with its OAuth challenge (below).
  const KEYED = ["/v1/search?q=CFDI40149", "/v1/sources"];

  async function expectUnauthorized(response: Response) {
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(response.headers.get("www-authenticate")).toBe('Bearer realm="codice"');
    expect(await response.json()).toMatchObject({
      type: "about:blank",
      status: 401,
      code: "unauthorized",
      requestId: "auth-check",
    });
  }

  it.each(KEYED)("refuses %s without a key", async (path) => {
    const response = await SELF.fetch(`https://codice.test${path}`, {
      headers: { "x-request-id": "auth-check" },
    });

    await expectUnauthorized(response);
  });

  it.each([
    ["an unknown bearer key", { authorization: "Bearer cdc_unknown" }],
    ["an unknown x-api-key", { "x-api-key": "cdc_unknown" }],
    ["a key without the cdc_ prefix", { authorization: "Bearer test_valid" }],
    ["a non-bearer scheme", { authorization: "Basic cdc_test_basic" }],
  ])("refuses %s", async (_, headers) => {
    for (const path of KEYED) {
      const response = await SELF.fetch(`https://codice.test${path}`, {
        headers: { "x-request-id": "auth-check", ...headers },
      });

      await expectUnauthorized(response);
    }
  });

  it.each([
    ["Authorization: Bearer", { authorization: "Bearer cdc_test_bearer" }],
    ["x-api-key", { "x-api-key": "cdc_test_header" }],
  ])("serves a valid key in %s", async (_, headers) => {
    const response = await SELF.fetch("https://codice.test/v1/sources", { headers });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { sources: [] } });
  });

  it.each([
    ["an unknown bearer key", { authorization: "Bearer cdc_unknown" }],
    ["an unknown x-api-key", { "x-api-key": "cdc_unknown" }],
  ])("refuses %s on /mcp with the key challenge", async (_, headers) => {
    const response = await SELF.fetch("https://codice.test/mcp", {
      headers: { "x-request-id": "auth-check", ...headers },
    });

    await expectUnauthorized(response);
  });

  it("refuses an OAuth access token on /v1, which is not its resource", async () => {
    const response = await SELF.fetch("https://codice.test/v1/sources", {
      headers: { "x-request-id": "auth-check", authorization: "Bearer at_test_v1" },
    });

    await expectUnauthorized(response);
  });

  it("refuses with 500 when the accounts binding is missing", async () => {
    const response = await fetchWith(
      "/v1/sources",
      { ACCOUNTS: undefined },
      { headers: { authorization: "Bearer cdc_test_unbound" } },
    );

    expect(response.status).toBe(500);
  });

  it.each(["/", "/health", "/ready"])("leaves %s open", async (path) => {
    const response = await SELF.fetch(`https://codice.test${path}`);

    expect(response.status).toBe(200);
  });
});

describe("MCP authorization", () => {
  const METADATA = "https://codice.test/.well-known/oauth-protected-resource/mcp";
  const CHALLENGE = `Bearer realm="codice", resource_metadata="${METADATA}", scope="codice:read"`;
  const mcpCall = (headers: Record<string, string>) =>
    SELF.fetch("https://codice.test/mcp", {
      method: "POST",
      headers: {
        "x-request-id": "mcp-auth",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

  it.each([METADATA, "https://codice.test/.well-known/oauth-protected-resource"])(
    "publishes /mcp's protected resource metadata at %s",
    async (url) => {
      const response = await SELF.fetch(url);

      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(await response.json()).toEqual({
        resource: "https://codice.test/mcp",
        authorization_servers: ["https://codice.test/api/auth"],
        scopes_supported: ["codice:read"],
        bearer_methods_supported: ["header"],
        resource_name: "Códice",
        resource_documentation: "https://codice.test/docs",
      });
    },
  );

  it("answers /mcp without a credential with the challenge that starts OAuth", async () => {
    const response = await mcpCall({});

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(CHALLENGE);
    expect(await response.json()).toMatchObject({ status: 401, code: "unauthorized" });
  });

  it.each([
    ["an unknown access token", "Bearer at_unknown"],
    ["a key without the cdc_ prefix", "Bearer test_valid"],
  ])("refuses %s as an invalid token", async (_, authorization) => {
    const response = await mcpCall({ authorization });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(`${CHALLENGE}, error="invalid_token"`);
  });

  it("serves a valid access token", async () => {
    const response = await mcpCall({ authorization: "Bearer at_test_tools" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"tools"');
  });

  it("refuses a token without the scope with insufficient_scope", async () => {
    const response = await mcpCall({ authorization: "Bearer at_noscope_tools" });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toBe(
      `${CHALLENGE}, error="insufficient_scope"`,
    );
    expect(await response.json()).toMatchObject({ status: 403, code: "insufficient_scope" });
  });

  it("still serves an API key", async () => {
    const response = await mcpCall({ authorization: "Bearer cdc_test_mcpkey" });

    expect(response.status).toBe(200);
  });
});

describe("per-key rate limit", () => {
  // wrangler.test.jsonc allows 3 requests per key per minute.
  async function exhaust(path: string, headers: Record<string, string>) {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await SELF.fetch(`https://codice.test${path}`, { headers });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.headers.get("retry-after")).toBe("60");
        expect(response.headers.get("content-type")).toBe("application/problem+json");
        expect(await response.json()).toMatchObject({ status: 429, code: "rate_limited" });
      }
    }
    return statuses;
  }

  // The first three reach the route, whatever it answers (a bad request, an unknown path); the
  // fourth is refused.
  it.each(["/v1/search", "/mcp", "/mcp/sse"])("limits %s per key", async (path) => {
    const key = `cdc_test_limit${path.replaceAll("/", "_")}`;
    const limited = (statuses: number[]) => statuses.map((status) => status === 429);

    expect(limited(await exhaust(path, { authorization: `Bearer ${key}` }))).toEqual([
      false,
      false,
      false,
      true,
    ]);
    // Another key keeps its own allowance, from the same address.
    expect(limited(await exhaust(path, { authorization: `Bearer ${key}2` }))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it("limits /mcp per OAuth user, whichever token they send", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await SELF.fetch("https://codice.test/mcp", {
        headers: { authorization: "Bearer at_test_limited" },
      });
      statuses.push(response.status);
    }

    expect(statuses.map((status) => status === 429)).toEqual([false, false, false, true]);
  });

  it("counts a key the same in either header", async () => {
    const statuses: number[] = [];
    for (const headers of <Record<string, string>[]>[
      { authorization: "Bearer cdc_test_both" },
      { "x-api-key": "cdc_test_both" },
      { authorization: "Bearer cdc_test_both" },
      { "x-api-key": "cdc_test_both" },
    ]) {
      statuses.push((await SELF.fetch("https://codice.test/v1/sources", { headers })).status);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it("leaves liveness and readiness unlimited", async () => {
    expect(await exhaust("/health", {})).toEqual([200, 200, 200, 200]);
    expect(await exhaust("/ready", {})).toEqual([200, 200, 200, 200]);
  });
});

describe("usage", () => {
  const verifier = env.ACCOUNTS as unknown as NonNullable<CodiceBindings["ACCOUNTS"]>;

  /** The accounts stub's verifiers, with the usage reports kept for the test to read. */
  function recordingAccounts() {
    const events: UsageEvent[] = [];
    const accounts: NonNullable<CodiceBindings["ACCOUNTS"]> = {
      verifyApiKey: (key) => verifier.verifyApiKey(key),
      verifyAccessToken: (token) => verifier.verifyAccessToken(token),
      mcpAuthorization: () => verifier.mcpAuthorization(),
      recordUsage: async (reported) => {
        events.push(...reported);
      },
    };
    return { accounts, events };
  }

  async function call(path: string, accounts: CodiceBindings["ACCOUNTS"], init: RequestInit) {
    const context = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://codice.test${path}`, init),
      { ...bindings, ACCOUNTS: accounts },
      context,
    );
    await waitOnExecutionContext(context);
    return response;
  }

  it("reports a /v1 call by the operation its MCP tool shares, with the key and team", async () => {
    const { accounts, events } = recordingAccounts();
    const response = await call("/v1/sources", accounts, {
      headers: { authorization: "Bearer cdc_test_usagehttp" },
    });

    expect(response.status).toBe(200);
    expect(events).toEqual([
      {
        caller: {
          kind: "api_key",
          keyId: "usagehttp",
          organizationId: "team-test",
          userId: "user-test",
        },
        surface: "http",
        operation: "list_sources",
        status: 200,
        durationMs: expect.any(Number),
        at: expect.any(Number),
      },
    ]);
  });

  it("reports an MCP tool call by its tool, for the OAuth user and client", async () => {
    const { accounts, events } = recordingAccounts();
    await call("/mcp", accounts, {
      method: "POST",
      headers: {
        authorization: "Bearer at_test_usagemcp",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_sources", arguments: {} },
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      caller: {
        kind: "oauth",
        userId: "usagemcp",
        clientId: "https://client.test/metadata.json",
      },
      surface: "mcp",
      operation: "list_sources",
    });
  });

  it("reports a batch lookup as one call of its tool", async () => {
    const { accounts, events } = recordingAccounts();
    await call("/mcp", accounts, {
      method: "POST",
      headers: {
        authorization: "Bearer at_test_usagebatch",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "lookup_error", arguments: { codes: ["CFDI40149", "CFDI40147"] } },
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ surface: "mcp", operation: "lookup_error" });
  });

  it("leaves out MCP bookkeeping and refused credentials", async () => {
    const { accounts, events } = recordingAccounts();
    await call("/mcp", accounts, {
      method: "POST",
      headers: {
        authorization: "Bearer at_test_usagelist",
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    await call("/v1/sources", accounts, { headers: { authorization: "Bearer nope" } });

    expect(events).toEqual([]);
  });
});
