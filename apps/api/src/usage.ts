import * as Sentry from "@sentry/cloudflare";
import type { Context, MiddlewareHandler } from "hono";

import type { UsageEvent } from "@codice/contracts";

import type { CodiceEnv } from "./env";

/**
 * Usage (SPEC.md, "Usage"): after a `/v1` call or an MCP tool call is answered, it is reported to
 * `codice-app` (`ACCOUNTS.recordUsage`), which counts it for the dashboard's Uso page. The report
 * runs after the response, so it never delays or fails a call.
 */

/** The `/v1` routes as the MCP tool that calls the same handler, or their own name. */
function httpOperation(pathname: string): string | undefined {
  const [, version, resource, ...rest] = pathname.split("/");
  if (version !== "v1") return undefined;
  switch (resource) {
    case "search":
      return "search";
    case "passages":
      return "read_passage";
    case "errors":
      return "lookup_error";
    case "changes":
      return "list_changes";
    case "sources":
      return rest.length > 0 ? "read_source" : "list_sources";
    case "catalogs":
      return rest.length > 1 ? "lookup_catalog" : "list_catalog";
    case "chat":
      return "chat";
    default:
      return undefined;
  }
}

/**
 * The tools an MCP request calls: one JSON-RPC message or a batch. Everything else MCP sends
 * (initialize, listing the tools, notifications) is the client's own bookkeeping, not usage.
 */
async function mcpOperations(request: Request): Promise<string[]> {
  if (request.method !== "POST") return [];
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (typeof message !== "object" || message === null) return [];
    const { method, params } = message as { method?: unknown; params?: { name?: unknown } };
    return method === "tools/call" && typeof params?.name === "string" ? [params.name] : [];
  });
}

/** Runs after the response when the runtime gives a context to wait on (tests may not). */
function afterResponse(context: Context<CodiceEnv>, task: Promise<void>) {
  const reported = task.catch((error: unknown) => {
    Sentry.captureException(error instanceof Error ? error : new Error("Usage report failed"), {
      fingerprint: ["codice", "usage", "report"],
    });
  });
  try {
    context.executionCtx.waitUntil(reported);
  } catch {
    // No execution context: the promise runs on its own.
  }
}

/** Reports the call once answered. Mount after the credential check, before the rate limit. */
export const recordUsage: MiddlewareHandler<CodiceEnv> = async (context, next) => {
  const at = Date.now();
  const { pathname } = new URL(context.req.url);
  const surface = pathname === "/mcp" || pathname.startsWith("/mcp/") ? "mcp" : "http";
  const operation = surface === "http" ? httpOperation(pathname) : undefined;
  const operations =
    surface === "mcp" ? await mcpOperations(context.req.raw) : operation ? [operation] : [];
  await next();
  const accounts = context.env.ACCOUNTS;
  if (operations.length === 0 || !accounts) return;
  const caller = context.get("caller");
  const status = context.res.status;
  const durationMs = Date.now() - at;
  const events: UsageEvent[] = operations.map((name) => ({
    caller,
    surface,
    operation: name,
    status,
    durationMs,
    at,
  }));
  afterResponse(context, accounts.recordUsage(events));
};
