import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * Stands in for `codice-app`'s `CodiceAccounts` (bound as `ACCOUNTS` in vitest.config.mts): any
 * `cdc_test_<id>` key is valid, with key id `<id>`, so each test can hold its own rate bucket.
 */
export class CodiceAccounts extends WorkerEntrypoint {
  verifyApiKey(key) {
    const id = typeof key === "string" ? /^cdc_test_(\w+)$/u.exec(key)?.[1] : undefined;
    return id ? { valid: true, keyId: id, organizationId: "team-test" } : { valid: false };
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
