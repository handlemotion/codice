import { describe, expect, it } from "vitest";

import { CHECKS, report, runCheck, verdict } from "./synthetic-check.mjs";

const search = CHECKS.find((check) => check.name === "search");
const error = CHECKS.find((check) => check.name === "error");
const ready = CHECKS.find((check) => check.name === "ready");

describe("verdict", () => {
  it("passes a fast 200 with the expected body", () => {
    expect(verdict(ready, { status: 200, ms: 120, body: { status: "ready" } })).toBeNull();
    expect(
      verdict(search, {
        status: 200,
        ms: 3_000,
        body: { data: { results: [{ passageId: "a" }] } },
      }),
    ).toBeNull();
    expect(
      verdict(error, { status: 200, ms: 90, body: { data: { code: "CFDI40149" } } }),
    ).toBeNull();
  });

  it("fails a non-200, an empty search and a slow answer", () => {
    expect(verdict(error, { status: 401, ms: 50, body: {} })).toBe("HTTP 401");
    expect(verdict(search, { status: 200, ms: 900, body: { data: { results: [] } } })).toBe(
      "unexpected body",
    );
    expect(verdict(error, { status: 200, ms: 1_501, body: { data: { code: "CFDI40149" } } })).toBe(
      "1501 ms > 1500 ms",
    );
  });
});

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    const { status, body } = responses.shift();
    return new Response(JSON.stringify(body), {
      status,
      headers: { "x-request-id": "req-1", "server-timing": "total;dur=12" },
    });
  };
  return { calls, fetchImpl };
}

describe("runCheck", () => {
  it("sends the key only to keyed routes", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 200, body: { status: "ready" } },
      { status: 200, body: { data: { code: "CFDI40149" } } },
    ]);
    const options = { baseUrl: "https://codice.example", key: "cdc_test_1", fetchImpl };
    await runCheck(ready, options);
    await runCheck(error, options);
    expect(calls[0]).toMatchObject({ url: "https://codice.example/ready" });
    expect(calls[0].headers.authorization).toBeUndefined();
    expect(calls[1]).toMatchObject({ url: "https://codice.example/v1/errors/CFDI40149" });
    expect(calls[1].headers.authorization).toBe("Bearer cdc_test_1");
  });

  it("tries once more after a failure and passes on the second attempt", async () => {
    const { calls, fetchImpl } = fakeFetch([
      { status: 503, body: {} },
      { status: 200, body: { data: { code: "CFDI40149" } } },
    ]);
    const result = await runCheck(error, {
      baseUrl: "https://codice.example",
      key: "k",
      fetchImpl,
    });
    expect(calls).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => a.reason)).toEqual(["HTTP 503", null]);
  });

  it("fails when both attempts fail, and the report never holds the key", async () => {
    const { fetchImpl } = fakeFetch([
      { status: 401, body: {} },
      { status: 401, body: {} },
    ]);
    const result = await runCheck(error, {
      baseUrl: "https://codice.example",
      key: "cdc_secret",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    const text = report([result]);
    expect(text).toContain("❌ HTTP 401");
    expect(text).toContain("`req-1`");
    expect(text).not.toContain("cdc_secret");
  });
});
