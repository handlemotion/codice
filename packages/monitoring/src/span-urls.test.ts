import { describe, expect, it } from "vitest";

import { scrubSpanUrls, scrubTransactionUrls } from "./span-urls.js";

describe("scrubSpanUrls", () => {
  it("drops the query and fragment of an outgoing request span", () => {
    const span = scrubSpanUrls({
      data: {
        url: "https://dash.better-auth.com/security/is-blocked?visitorId=&ip=2806%3A109f",
        "http.url": "https://dash.better-auth.com/security/is-blocked?visitorId=&ip=2806%3A109f",
        "url.full": "https://dash.better-auth.com/security/is-blocked?visitorId=&ip=2806%3A109f",
        "http.query": "?visitorId=&ip=2806%3A109f",
        "http.fragment": "#top",
        "server.address": "dash.better-auth.com",
        "http.method": "GET",
      },
    });

    expect(span.data).toEqual({
      url: "https://dash.better-auth.com/security/is-blocked",
      "http.url": "https://dash.better-auth.com/security/is-blocked",
      "url.full": "https://dash.better-auth.com/security/is-blocked",
      "server.address": "dash.better-auth.com",
      "http.method": "GET",
    });
  });

  it("drops server-function arguments from a relative browser fetch URL", () => {
    const span = scrubSpanUrls({
      data: { url: "/_serverFn/0451?payload=%7B%22orgSlug%22%7D", "http.query": "?payload=x" },
    });

    expect(span.data).toEqual({ url: "/_serverFn/0451" });
  });

  it("drops the query of an incoming request span and keeps its path", () => {
    const span = scrubSpanUrls({
      data: {
        "url.full":
          "https://api.transitive.app/v1/session/organizations/o/stamping/documents?query=RIME2610000519",
        "http.target": "/v1/session/organizations/o/stamping/documents?query=RIME2610000519",
        "url.query": "query=RIME2610000519",
      },
    });

    expect(span.data).toEqual({
      "url.full": "https://api.transitive.app/v1/session/organizations/o/stamping/documents",
      "http.target": "/v1/session/organizations/o/stamping/documents",
    });
  });

  it("leaves a span without URLs alone", () => {
    const data = { "db.system": "postgresql", "db.statement": "select $1" };

    expect(scrubSpanUrls({ data: { ...data } }).data).toEqual(data);
    expect(scrubSpanUrls({})).toEqual({});
  });
});

describe("scrubTransactionUrls", () => {
  it("drops the transaction's request query", () => {
    expect(
      scrubTransactionUrls({
        request: {
          url: "https://transitive.app/astrum?search=ACME#row",
          query_string: "search=ACME",
        },
      }),
    ).toEqual({ request: { url: "https://transitive.app/astrum" } });
    expect(scrubTransactionUrls({})).toEqual({});
  });
});
