/** Share of requests, cron ticks and page loads traced when no upstream decision exists. */
export const SENTRY_TRACES_SAMPLE_RATE = 0.2;

// Uptime monitors hit these every minute; tracing them only spends span quota.
const PROBE_TRANSACTION = /^(?:GET|HEAD) \/(?:ready|health)\/?$/u;

type TraceSamplingContext = {
  readonly name: string;
  readonly inheritOrSampleWith: (fallbackSampleRate: number) => number;
};

/**
 * The one `tracesSampler` for every Transitive Sentry SDK. A trace that arrives with a decision
 * (the browser, another Worker over RPC) keeps it, so one request is traced end to end or not at all.
 */
export function sampleSentryTrace({ name, inheritOrSampleWith }: TraceSamplingContext): number {
  if (PROBE_TRANSACTION.test(name)) return 0;
  return inheritOrSampleWith(SENTRY_TRACES_SAMPLE_RATE);
}
