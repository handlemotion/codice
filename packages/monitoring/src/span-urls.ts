// URLs a span can carry. The SDKs' `dataCollection.urlQueryParams: false` covers error events
// but not span attributes, so outgoing and incoming request spans still record query strings.
const URL_ATTRIBUTES = ["url", "url.full", "http.url", "http.target"] as const;
const QUERY_ATTRIBUTES = ["http.query", "http.fragment", "url.query", "url.fragment"] as const;

function withoutQuery(url: string): string {
  const end = url.search(/[?#]/u);
  return end === -1 ? url : url.slice(0, end);
}

/**
 * The `beforeSendSpan` for every Transitive Sentry SDK. Query strings and fragments carry search
 * text, end-user IP addresses, filters and server-function arguments; paths stay so a span still
 * names its endpoint.
 */
export function scrubSpanUrls<T extends { data?: Record<string, unknown> }>(span: T): T {
  const data = span.data;
  if (!data) return span;
  for (const key of QUERY_ATTRIBUTES) delete data[key];
  for (const key of URL_ATTRIBUTES) {
    const value = data[key];
    if (typeof value === "string") data[key] = withoutQuery(value);
  }
  return span;
}

/** The `beforeSendTransaction` counterpart: the transaction's own request URL and query. */
export function scrubTransactionUrls<
  T extends { request?: { url?: string; query_string?: unknown } },
>(event: T): T {
  if (event.request) {
    delete event.request.query_string;
    if (typeof event.request.url === "string") event.request.url = withoutQuery(event.request.url);
  }
  return event;
}
