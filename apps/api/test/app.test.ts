import { env } from "cloudflare:workers";
import { createExecutionContext, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { CodiceBindings } from "../src/env";
import { app } from "../src/index";

const bindings = env as unknown as CodiceBindings;

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

  it.each(["CODICE_DATABASE", "CODICE_SEARCH", "CODICE_PUBLIC_RATE_LIMITER"] as const)(
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

describe("public rate limit", () => {
  // wrangler.test.jsonc allows 3 requests per client per minute.
  async function exhaust(path: string, client: string) {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await SELF.fetch(`https://codice.test${path}`, {
        headers: { "cf-connecting-ip": client },
      });
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
  it.each(["/v1/search", "/mcp", "/mcp/sse"])("limits %s per client", async (path) => {
    const client = `198.51.100.${path.length}`;
    const limited = (statuses: number[]) => statuses.map((status) => status === 429);

    expect(limited(await exhaust(path, client))).toEqual([false, false, false, true]);
    // Another client keeps its own allowance.
    expect(limited(await exhaust(path, `${client}1`))).toEqual([false, false, false, true]);
  });

  it("leaves liveness and readiness unlimited", async () => {
    expect(await exhaust("/health", "198.51.100.200")).toEqual([200, 200, 200, 200]);
  });
});
