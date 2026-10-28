#!/usr/bin/env node
// Synthetic check of the Códice API: calls `/ready`, a search and an error lookup the way a client
// does, and fails on a non-200, an unexpected body or a response slower than the check's limit
// (docs/operations/monitoring.md, "Synthetic check").
//
//   CODICE_BASE_URL=https://codice.io CODICE_API_KEY=cdc_… node scripts/ops/synthetic-check.mjs \
//     [--details-file details.md]
//
// Each check gets a second attempt when the first fails, so one slow request is not an alert.
// The report (a Markdown table) goes to stdout, to GITHUB_STEP_SUMMARY when Actions sets it, and to
// `--details-file` for the alert issue. The key is sent, never printed.

import { appendFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

/**
 * The limits are outage and regression tripwires for one request from a GitHub runner, not a p95
 * (Sentry's alerts watch that). Basis: docs/operations/performance.md, "Local measurement".
 */
export const CHECKS = [
  {
    // No I/O at all: network, TLS and the edge → API service binding hop.
    name: "ready",
    path: "/ready",
    auth: false,
    maxMs: 1_000,
    expect: (body) => body?.status === "ready",
  },
  {
    // AI Search's time: local p95 2,500 ms, the slowest single search seen 3,959 ms. Twice that.
    name: "search",
    path: "/v1/search?q=CFDI40149",
    auth: true,
    maxMs: 8_000,
    expect: (body) => Array.isArray(body?.data?.results) && body.data.results.length > 0,
  },
  {
    // Key check (KV) and one or two D1 reads: local p95 26 ms, plus the round trips to D1.
    name: "error",
    path: "/v1/errors/CFDI40149",
    auth: true,
    maxMs: 1_500,
    expect: (body) => body?.data?.code === "CFDI40149",
  },
];

const ATTEMPTS = 2;
/** A request is abandoned after this, whatever its limit: long enough to see how slow it was. */
const TIMEOUT_MS = 20_000;

/** Why one response fails its check, or null when it passes. */
export function verdict(check, { status, ms, body }) {
  if (status !== 200) return `HTTP ${status}`;
  if (!check.expect(body)) return "unexpected body";
  if (ms > check.maxMs) return `${ms} ms > ${check.maxMs} ms`;
  return null;
}

async function attempt(check, { baseUrl, key, fetchImpl }) {
  const started = performance.now();
  try {
    const response = await fetchImpl(new URL(check.path, baseUrl), {
      headers: {
        "user-agent": "codice-synthetic-check",
        ...(check.auth ? { authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    const ms = Math.round(performance.now() - started);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return {
      status: response.status,
      ms,
      reason: verdict(check, { status: response.status, ms, body }),
      requestId: response.headers.get("x-request-id"),
      serverTiming: response.headers.get("server-timing"),
    };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { status: 0, ms, reason: error.name === "TimeoutError" ? "timed out" : error.message };
  }
}

/** Runs one check, again once if it fails. */
export async function runCheck(check, options) {
  const attempts = [];
  for (let i = 0; i < ATTEMPTS; i++) {
    const result = await attempt(check, options);
    attempts.push(result);
    if (!result.reason) break;
  }
  return { check, ok: !attempts.at(-1).reason, attempts };
}

export function report(results) {
  const rows = results.flatMap(({ check, attempts }) =>
    attempts.map((a, i) =>
      [
        i === 0 ? `\`${check.path}\`` : "(again)",
        a.status || "–",
        `${a.ms} ms`,
        `${check.maxMs} ms`,
        a.reason ? `❌ ${a.reason}` : "✅",
        a.serverTiming ? `\`${a.serverTiming}\`` : "–",
        a.requestId ? `\`${a.requestId}\`` : "–",
      ].join(" | "),
    ),
  );
  return [
    "| Check | Status | Time | Limit | Result | server-timing | x-request-id |",
    "| --- | --: | --: | --: | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { "details-file": { type: "string" } } });
  const baseUrl = process.env.CODICE_BASE_URL;
  const key = process.env.CODICE_API_KEY;
  if (!baseUrl || !key) throw new Error("Set CODICE_BASE_URL and CODICE_API_KEY");
  const results = [];
  for (const check of CHECKS)
    results.push(await runCheck(check, { baseUrl, key, fetchImpl: fetch }));
  const failed = results.filter((r) => !r.ok);
  const text = `Synthetic check of ${baseUrl}: ${failed.length === 0 ? "passed" : `${failed.length} failed`}.\n\n${report(results)}`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  if (values["details-file"]) writeFileSync(values["details-file"], text);
  if (failed.length > 0) process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
