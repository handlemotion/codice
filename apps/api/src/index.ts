import * as Sentry from "@sentry/cloudflare";
import { Hono, type MiddlewareHandler } from "hono";

import type { CodiceKnowledgeService, CodiceResult } from "@codice/contracts";
import { sampleSentryTrace, scrubSpanUrls, scrubTransactionUrls } from "@codice/monitoring";

import { createMcpHandler } from "agents/mcp/server";
import { WorkerEntrypoint } from "cloudflare:workers";

import { chatResponse } from "./chat";
import type { CodiceBindings, CodiceEnv } from "./env";
import {
  CodiceProblem,
  listCatalog,
  listSources,
  lookupCatalog,
  lookupError,
  readPassage,
  readSource,
  search,
  type SearchParameters,
} from "./handlers";
import { apiJson, problem, requestIdFor } from "./http";
import { createCodiceMcpServer } from "./mcp";

/**
 * Códice: the indexed SAT and Mexican customs knowledge service. Search is AI Search's (binding
 * `CODICE_SEARCH`); exact lookups and provenance are D1's (`CODICE_DATABASE`). SPEC.md describes
 * the corpus, the API, and the MCP surface.
 */
export type Bindings = CodiceBindings;

const SERVICE = "codice";

export const app = new Hono<CodiceEnv>();

app.use("*", async (context, next) => {
  const requestId = requestIdFor(context.req.raw);
  context.set("requestId", requestId);
  await next();
  context.res.headers.set("x-request-id", requestId);
  if (context.res.status >= 500) {
    Sentry.captureException(new Error("Códice handled server error"), {
      fingerprint: ["codice", "handled-server-error", String(context.res.status)],
      tags: { requestId, status: String(context.res.status) },
    });
  }
});

app.onError((error, context) => {
  const requestId = context.get("requestId");
  // A refusal Códice chose (a bad parameter, an unknown code, AI Search down) is its own problem;
  // the middleware above still reports a 5xx one to Sentry.
  if (error instanceof CodiceProblem) {
    return problem(requestId, error.status, error.code, error.title, error.detail);
  }
  Sentry.captureException(error instanceof Error ? error : new Error("Códice request failed"), {
    fingerprint: ["codice", "request", "error"],
    tags: { requestId },
  });
  return problem(requestId, 500, "internal_error", "Internal error");
});

// The public routes (`/v1`, `/mcp`) need no sign-in, so the client is its address. SPEC.md,
// "Rate limiting".
function rateLimit(
  binding: "CODICE_PUBLIC_RATE_LIMITER" | "CODICE_CHAT_RATE_LIMITER",
): MiddlewareHandler<CodiceEnv> {
  return async (context, next) => {
    const limiter = context.env[binding];
    if (!limiter) throw new Error(`${binding} is not bound`);
    const client = context.req.header("cf-connecting-ip") ?? "unknown";
    const { success } = await limiter.limit({ key: `client:${client}` });
    if (!success) {
      const response = problem(context.get("requestId"), 429, "rate_limited", "Too many requests");
      response.headers.set("retry-after", "60");
      return response;
    }
    await next();
  };
}
const publicRateLimit = rateLimit("CODICE_PUBLIC_RATE_LIMITER");
// Hono's `/x/*` also matches `/x` itself.
app.use("/v1/*", publicRateLimit);
app.use("/mcp/*", publicRateLimit);
// Each chat turn spends model tokens and a few searches, so it has its own, stricter limit.
app.use("/v1/chat", rateLimit("CODICE_CHAT_RATE_LIMITER"));

app.get("/", (context) => context.json({ service: SERVICE, status: "ok" }));
app.get("/health", (context) => context.json({ service: SERVICE, status: "ok" }));
app.get("/ready", (context) => {
  const { CODICE_DATABASE, CODICE_SEARCH, CODICE_PUBLIC_RATE_LIMITER } = context.env;
  if (
    typeof CODICE_DATABASE?.prepare !== "function" ||
    typeof CODICE_SEARCH?.search !== "function" ||
    typeof CODICE_PUBLIC_RATE_LIMITER?.limit !== "function"
  ) {
    return problem(
      context.get("requestId"),
      503,
      "codice_bindings_not_ready",
      "Códice bindings are not ready",
    );
  }
  return context.json({ service: SERVICE, status: "ready" as const });
});

app.get("/v1/search", async (context) =>
  apiJson(
    context,
    await search(context.env, {
      q: context.req.query("q"),
      asOf: context.req.query("asOf"),
      source: context.req.query("source"),
      kind: context.req.query("kind"),
      limit: context.req.query("limit"),
    }),
  ),
);

// A passage id holds a slash (`<source>/<anchor>.md`), so the parameter takes the rest of the path.
app.get("/v1/passages/:id{.+}", async (context) =>
  apiJson(context, await readPassage(context.env, context.req.param("id"))),
);

app.get("/v1/sources", async (context) => apiJson(context, await listSources(context.env)));

app.get("/v1/sources/:id", async (context) =>
  apiJson(context, await readSource(context.env, context.req.param("id"))),
);

app.get("/v1/errors/:code", async (context) =>
  apiJson(context, await lookupError(context.env, context.req.param("code"))),
);

app.get("/v1/catalogs/:name", async (context) =>
  apiJson(context, await listCatalog(context.env, context.req.param("name"))),
);

app.get("/v1/catalogs/:name/:key", async (context) =>
  apiJson(
    context,
    // Every query parameter names a column to filter on (SPEC.md, "HTTP API").
    await lookupCatalog(
      context.env,
      context.req.param("name"),
      context.req.param("key"),
      context.req.queries(),
    ),
  ),
);

app.post("/v1/chat", (context) => chatResponse(context.env, context.req.raw));

app.all("/mcp", (context) => {
  const serve = createMcpHandler(() => createCodiceMcpServer(context.env), { route: "/mcp" });
  return serve.fetch(context.req.raw);
});

app.notFound((context) => problem(context.get("requestId"), 404, "not_found", "Not found"));

/** The handler's data, or the problem a `/v1` route would have sent for its refusal. */
async function internalCall<T>(handler: () => Promise<T>): Promise<CodiceResult<T>> {
  try {
    return { ok: true, data: await handler() };
  } catch (error) {
    if (!(error instanceof CodiceProblem)) {
      Sentry.captureException(error instanceof Error ? error : new Error("Códice call failed"), {
        fingerprint: ["codice", "internal", "error"],
      });
      throw error;
    }
    return { ok: false, problem: { status: error.status, code: error.code, title: error.title } };
  }
}

/**
 * The `/v1` handlers for Transitive's own Workers over a service binding (the Agent's `CODICE`).
 * They skip the public per-client rate limit, which keys on `cf-connecting-ip`: a binding's
 * requests carry none, so every Agent run would share one bucket. A refusal comes back as the
 * problem, since RPC keeps only an error's message.
 */
export class CodiceKnowledge extends WorkerEntrypoint<Bindings> implements CodiceKnowledgeService {
  search(parameters: SearchParameters) {
    return internalCall(() => search(this.env, parameters));
  }
  readPassage(id: string) {
    return internalCall(() => readPassage(this.env, id));
  }
  lookupError(code: string) {
    return internalCall(() => lookupError(this.env, code));
  }
  lookupCatalog(name: string, key: string) {
    return internalCall(() => lookupCatalog(this.env, name, key));
  }
  listCatalog(name: string) {
    return internalCall(() => listCatalog(this.env, name));
  }
}

export default Sentry.withSentry<Bindings>(
  (env) => ({
    dsn: env.SENTRY_RELEASE ? env.SENTRY_DSN : "",
    release: env.SENTRY_RELEASE,
    environment: env.SENTRY_RELEASE ? "production" : "development",
    initialScope: {
      tags: {
        service: "transitive-codice",
        runtime: "worker",
        environment: env.SENTRY_RELEASE ? "production" : "development",
        cloudflare_version_id: env.CF_VERSION_METADATA?.id ?? "local",
      },
    },
    sendDefaultPii: false,
    tracesSampler: sampleSentryTrace,
    beforeSendSpan: scrubSpanUrls,
    beforeSendTransaction: scrubTransactionUrls,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["x-request-id"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      delete event.message;
      for (const exception of event.exception?.values ?? []) exception.value = exception.type;
      return event;
    },
  }),
  app,
);
