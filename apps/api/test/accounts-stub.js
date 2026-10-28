import { WorkerEntrypoint } from "cloudflare:workers";

/**
 * Stands in for `codice-app`'s `CodiceAccounts` (bound as `ACCOUNTS` in vitest.config.mts): any
 * `cdc_test_<id>` key is valid, with key id `<id>`, so each test can hold its own rate bucket.
 * Any `at_test_<user>` access token is valid for user `<user>` with the `/mcp` scope, and an
 * `at_noscope_<user>` one is valid without it.
 */
export class CodiceAccounts extends WorkerEntrypoint {
  verifyApiKey(key) {
    const id = typeof key === "string" ? /^cdc_test_(\w+)$/u.exec(key)?.[1] : undefined;
    return id ? { valid: true, keyId: id, organizationId: "team-test" } : { valid: false };
  }
  verifyAccessToken(token) {
    const [, kind, user] = /^at_(test|noscope)_(\w+)$/u.exec(String(token)) ?? [];
    if (!user) return { valid: false };
    const scopes = kind === "test" ? ["codice:read", "offline_access"] : ["offline_access"];
    return { valid: true, userId: user, clientId: "https://client.test/metadata.json", scopes };
  }
  recordUsage() {}
  mcpAuthorization() {
    return {
      issuer: "https://codice.test/api/auth",
      resource: "https://codice.test/mcp",
      scope: "codice:read",
    };
  }
}

export default { fetch: () => new Response(null, { status: 404 }) };
