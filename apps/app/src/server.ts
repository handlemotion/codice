import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { CodiceAccountsService } from "@codice/contracts";

import { verifyApiKey } from "./server/api-key-store";

/** The dashboard: pages, server functions and Better Auth at `/api/auth/*`. */
export default createServerEntry({
  fetch(request, opts) {
    return handler.fetch(request, opts);
  },
});

/**
 * Bound by `codice-api` as `ACCOUNTS` (apps/api/SPEC.md, "Auth"). It reads only KV, so a call
 * never touches D1.
 */
export class CodiceAccounts
  extends WorkerEntrypoint<CloudflareBindings>
  implements CodiceAccountsService
{
  verifyApiKey(key: string) {
    return verifyApiKey(this.env.API_KEYS, key, (promise) => this.ctx.waitUntil(promise));
  }
}
