/**
 * The `CodiceAccounts` entrypoint of `codice-app`, which `codice-api` binds as `ACCOUNTS` to
 * authenticate `/v1` and `/mcp` calls (apps/api/SPEC.md, "Auth").
 */
export type ApiKeyVerification =
  | { valid: true; keyId: string; organizationId: string }
  | { valid: false };

export interface CodiceAccountsService {
  /** Looks up a `cdc_` key; anything that is not a live key is `{ valid: false }`. */
  verifyApiKey(key: string): Promise<ApiKeyVerification>;
}
