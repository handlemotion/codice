import * as Sentry from "@sentry/cloudflare";
import { Hono, type Context, type MiddlewareHandler } from "hono";

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
import { timedRequest } from "./timing";
import { recordUsage } from "./usage";

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
  const serverTiming = await timedRequest(next);
  context.res.headers.set("x-request-id", requestId);
  context.res.headers.set("server-timing", serverTiming);
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

/** The bearer token of `Authorization: Bearer`, if any. */
function bearerToken(request: Request): string | undefined {
  return request.headers.get("authorization")?.match(/^Bearer\s+(\S+)\s*$/iu)?.[1];
}

/** A `cdc_` key from `Authorization: Bearer` or, failing that, `x-api-key`. */
function presentedKey(request: Request): string | undefined {
  return bearerToken(request) ?? request.headers.get("x-api-key")?.trim() ?? undefined;
}

function accountsOf(context: Context<CodiceEnv>) {
  const accounts = context.env.ACCOUNTS;
  if (!accounts) throw new Error("ACCOUNTS is not bound");
  return accounts;
}

/** Answers with the problem for a missing or refused credential, with its challenge. */
function unauthorized(context: Context<CodiceEnv>, detail: string, challenge: string) {
  const response = problem(context.get("requestId"), 401, "unauthorized", "Unauthorized", detail);
  response.headers.set("www-authenticate", challenge);
  return response;
}

async function verifiedKey(context: Context<CodiceEnv>, key: string | undefined) {
  const verification = key
    ? await accountsOf(context).verifyApiKey(key)
    : { valid: false as const };
  if (!verification.valid) return undefined;
  // `userId` is missing while `codice-app` runs a version from before keys named their creator.
  const { keyId, organizationId, userId = null } = verification;
  return { kind: "api_key" as const, keyId, organizationId, userId };
}

// `/v1` takes a team's API key, verified by `codice-app` (`ACCOUNTS`). SPEC.md, "Auth".
const requireApiKey: MiddlewareHandler<CodiceEnv> = async (context, next) => {
  const key = presentedKey(context.req.raw);
  const caller = await verifiedKey(context, key);
  if (!caller) {
    return unauthorized(
      context,
      key
        ? "The API key is not valid."
        : "Send an API key as `Authorization: Bearer cdc_…` or `x-api-key`.",
      'Bearer realm="codice"',
    );
  }
  context.set("caller", caller);
  await next();
};

/** `/mcp`'s protected resource metadata (RFC 9728): the well-known prefix, then `/mcp`. */
const MCP_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource/mcp";

/** The metadata URL for a resource: on its origin, the well-known prefix before its path. */
function resourceMetadataUrl(resource: string) {
  const { origin, pathname } = new URL(resource);
  return `${origin}/.well-known/oauth-protected-resource${pathname === "/" ? "" : pathname}`;
}

// `/mcp` takes an OAuth access token `codice-app` issued for it, or a team's API key (a `cdc_`
// bearer or `x-api-key`). Without either, the challenge points an MCP client at the metadata
// that starts its OAuth flow. SPEC.md, "MCP authorization".
const requireMcpCredential: MiddlewareHandler<CodiceEnv> = async (context, next) => {
  const request = context.req.raw;
  const bearer = bearerToken(request);
  const usesApiKey = bearer ? bearer.startsWith("cdc_") : request.headers.has("x-api-key");
  if (usesApiKey) {
    const caller = await verifiedKey(context, presentedKey(request));
    if (!caller) return unauthorized(context, "The API key is not valid.", 'Bearer realm="codice"');
    context.set("caller", caller);
    return next();
  }

  const accounts = accountsOf(context);
  const [{ resource, scope }, verification] = await Promise.all([
    accounts.mcpAuthorization(),
    bearer ? accounts.verifyAccessToken(bearer) : { valid: false as const },
  ]);
  const metadata = resourceMetadataUrl(resource);
  const challenge = (error?: string) =>
    [
      'Bearer realm="codice"',
      `resource_metadata="${metadata}"`,
      `scope="${scope}"`,
      ...(error ? [`error="${error}"`] : []),
    ].join(", ");
  if (!verification.valid) {
    return unauthorized(
      context,
      bearer
        ? "The access token is not valid."
        : "Authorize with OAuth (see `www-authenticate`), or send an API key.",
      challenge(bearer ? "invalid_token" : undefined),
    );
  }
  if (!verification.scopes.includes(scope)) {
    const response = problem(
      context.get("requestId"),
      403,
      "insufficient_scope",
      "Insufficient scope",
      `The access token needs the \`${scope}\` scope.`,
    );
    response.headers.set("www-authenticate", challenge("insufficient_scope"));
    return response;
  }
  context.set("caller", {
    kind: "oauth",
    userId: verification.userId,
    clientId: verification.clientId,
  });
  await next();
};

function limited(context: Context<CodiceEnv>) {
  const response = problem(context.get("requestId"), 429, "rate_limited", "Too many requests");
  response.headers.set("retry-after", "60");
  return response;
}

// Each key has its own allowance, and so does each user signed in through OAuth, across their
// clients. SPEC.md, "Rate limiting".
const keyRateLimit: MiddlewareHandler<CodiceEnv> = async (context, next) => {
  const limiter = context.env.CODICE_PUBLIC_RATE_LIMITER;
  if (!limiter) throw new Error("CODICE_PUBLIC_RATE_LIMITER is not bound");
  const caller = context.get("caller");
  const key = caller.kind === "api_key" ? `key:${caller.keyId}` : `user:${caller.userId}`;
  const { success } = await limiter.limit({ key });
  if (!success) return limited(context);
  await next();
};

// Each chat turn spends model tokens and a few searches, so it has its own, stricter limit per
// visitor's address: the site's demo sends every visitor's turn with one key.
const chatRateLimit: MiddlewareHandler<CodiceEnv> = async (context, next) => {
  const limiter = context.env.CODICE_CHAT_RATE_LIMITER;
  if (!limiter) throw new Error("CODICE_CHAT_RATE_LIMITER is not bound");
  const client = context.req.header("cf-connecting-ip") ?? "unknown";
  const { success } = await limiter.limit({ key: `client:${client}` });
  if (!success) return limited(context);
  await next();
};

// Hono's `/x/*` also matches `/x` itself.
// Each answered call counts toward the caller's usage, a refusal of the rate limit included.
app.use("/v1/*", requireApiKey, recordUsage, keyRateLimit);
app.use("/mcp/*", requireMcpCredential, recordUsage, keyRateLimit);
app.use("/v1/chat", chatRateLimit);

app.get("/", (context) => context.json({ service: SERVICE, status: "ok" }));
app.get("/health", (context) => context.json({ service: SERVICE, status: "ok" }));
app.get("/ready", (context) => {
  const { ACCOUNTS, CODICE_DATABASE, CODICE_SEARCH, CODICE_PUBLIC_RATE_LIMITER } = context.env;
  if (
    typeof ACCOUNTS?.verifyApiKey !== "function" ||
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

// `/mcp`'s OAuth protected resource metadata (RFC 9728), at the path-inserted URL and at the
// root, which MCP clients try next; both describe `/mcp`. The issuer and resource are
// `codice-app`'s (`mcpAuthorization`), so the two Workers cannot disagree.
for (const path of [MCP_RESOURCE_METADATA_PATH, "/.well-known/oauth-protected-resource"]) {
  app.get(path, async (context) => {
    const { issuer, resource, scope } = await accountsOf(context).mcpAuthorization();
    context.header("cache-control", "public, max-age=300");
    // Browser-based MCP clients read it cross-origin; it holds nothing private.
    context.header("access-control-allow-origin", "*");
    return context.json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: [scope],
      bearer_methods_supported: ["header"],
      resource_name: "Códice",
      resource_documentation: new URL("/docs", resource).href,
    });
  });
}

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
 * They take no API key and skip the per-key rate limit: only a Worker the account binds can call
 * them. A refusal comes back as the problem, since RPC keeps only an error's message.
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
