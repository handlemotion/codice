import { AsyncLocalStorage } from "node:async_hooks";

import * as Sentry from "@sentry/cloudflare";

/**
 * Where a request's time goes, for Sentry and the caller (SPEC.md, "HTTP API"): each AI
 * Search call is a span and adds to the request's `search` metric, each search cache read or write
 * to its `cache` metric (`search-cache.ts`). D1 queries are spans through
 * `Sentry.instrumentD1WithSentry` (`records.ts`).
 */
type Metric = "search" | "cache";

const requestTimings = new AsyncLocalStorage<Map<Metric, number>>();

/** Runs `run` as a span and adds its time to the request's `metric`, when there is a request. */
export async function measured<T>(
  metric: Metric,
  span: { op: string; name: string },
  run: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await Sentry.startSpan(span, run);
  } finally {
    const timings = requestTimings.getStore();
    timings?.set(metric, (timings.get(metric) ?? 0) + performance.now() - started);
  }
}

/**
 * Runs a request and returns its `Server-Timing` value: `total`, and each metric spent. Calls run
 * in parallel add up, so a metric can exceed `total`. A Worker's clock moves only across I/O,
 * which is what these measure.
 */
export async function timedRequest(run: () => Promise<void>): Promise<string> {
  const timings = new Map<Metric, number>();
  const started = performance.now();
  await requestTimings.run(timings, run);
  return [["total", performance.now() - started] as const, ...timings]
    .map(([metric, duration]) => `${metric};dur=${duration.toFixed(1)}`)
    .join(", ");
}
