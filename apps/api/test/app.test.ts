import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

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
  const KEYED = ["/v1/search?q=CFDI40149", "/v1/sources", "/mcp"];

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
