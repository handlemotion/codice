import { describe, expect, it } from "vitest";

import { SENTRY_TRACES_SAMPLE_RATE, sampleSentryTrace } from "./sentry-tracing.js";

function sample(name: string, parentSampled?: boolean): number {
  return sampleSentryTrace({
    name,
    inheritOrSampleWith: (fallback) =>
      parentSampled === undefined ? fallback : parentSampled ? 1 : 0,
  });
}

describe("sampleSentryTrace", () => {
  it.each(["GET /ready", "GET /health", "HEAD /ready", "GET /health/"])(
    "never traces the uptime probe %s",
    (name) => {
      expect(sample(name)).toBe(0);
      expect(sample(name, true)).toBe(0);
    },
  );

  it("samples requests and cron ticks at the shared rate", () => {
    expect(sample("POST /v1/documents")).toBe(SENTRY_TRACES_SAMPLE_RATE);
    expect(sample("Scheduled Cron * * * * *")).toBe(SENTRY_TRACES_SAMPLE_RATE);
    expect(sample("GET /ready-documents")).toBe(SENTRY_TRACES_SAMPLE_RATE);
  });

  it("keeps the decision of a trace that arrives already sampled or dropped", () => {
    expect(sample("POST /v1/documents", true)).toBe(1);
    expect(sample("POST /v1/documents", false)).toBe(0);
  });
});
