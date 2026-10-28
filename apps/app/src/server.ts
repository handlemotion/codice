import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { env, WorkerEntrypoint } from "cloudflare:workers";

import type { CodiceAccountsService, McpAuthorization } from "@codice/contracts";

import { verifyAccessToken } from "./server/access-tokens";
import { verifyApiKey } from "./server/api-key-store";
import { createAuth, MCP_SCOPE, oauthIssuer } from "./server/auth";

/**
 * The authorization server's metadata (RFC 8414) sits at the root, outside `/api/auth`:
 * `/.well-known/oauth-authorization-server/api/auth`. Better Auth answers it from its own
 * `onRequest` hook, so the request only has to reach its handler. `/.well-known/
 * oauth-protected-resource` is `codice-api`'s (the edge sends it there).
 */
const AUTH_DISCOVERY_PREFIX = "/.well-known/oauth-authorization-server";

/** The dashboard: pages, server functions and Better Auth at `/api/auth/*`. */
export default createServerEntry({
  fetch(request, opts) {
    if (new URL(request.url).pathname.startsWith(AUTH_DISCOVERY_PREFIX)) {
      return createAuth(env).handler(request);
    }
    return handler.fetch(request, opts);
  },
});

/**
 * Bound by `codice-api` as `ACCOUNTS` (apps/api/SPEC.md, "Auth"). `verifyApiKey` reads only KV;
 * `verifyAccessToken` reads KV and, once per isolate, the signing keys from D1.
 */
export class CodiceAccounts
  extends WorkerEntrypoint<CloudflareBindings>
  implements CodiceAccountsService
{
  verifyApiKey(key: string) {
    return verifyApiKey(this.env.API_KEYS, key, (promise) => this.ctx.waitUntil(promise));
  }
  verifyAccessToken(token: string) {
    return verifyAccessToken(this.env, token);
  }
  mcpAuthorization(): McpAuthorization {
    return { issuer: oauthIssuer(this.env), resource: this.env.MCP_RESOURCE, scope: MCP_SCOPE };
  }
}
