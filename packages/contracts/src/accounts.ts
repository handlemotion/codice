/**
 * The `CodiceAccounts` entrypoint of `codice-app`, which `codice-api` binds as `ACCOUNTS` to
 * authenticate `/v1` and `/mcp` calls (apps/api/SPEC.md, "Auth").
 */
export type ApiKeyVerification =
  | { valid: true; keyId: string; organizationId: string }
  | { valid: false };

/**
 * An OAuth access token `codice-app` issued to an MCP client for the `/mcp` resource: the user
 * who authorized it, the client it was issued to, and the scopes it carries.
 */
export type AccessTokenVerification =
  | { valid: true; userId: string; clientId: string; scopes: string[] }
  | { valid: false };

/** What `/mcp`'s protected resource metadata (RFC 9728) and its challenges advertise. */
export interface McpAuthorization {
  /** The authorization server's issuer, `<origin>/api/auth`. */
  issuer: string;
  /** The canonical `/mcp` resource every access token is bound to (its `aud`). */
  resource: string;
  /** The scope a token needs for `/mcp`. */
  scope: string;
}

export interface CodiceAccountsService {
  /** Looks up a `cdc_` key; anything that is not a live key is `{ valid: false }`. */
  verifyApiKey(key: string): Promise<ApiKeyVerification>;
  /**
   * Verifies an OAuth access token for `/mcp`: its signature, issuer, audience, expiry, and that
   * the user has not disconnected the client since it was issued. It does not check the scope;
   * the caller does, so it can answer `insufficient_scope`.
   */
  verifyAccessToken(token: string): Promise<AccessTokenVerification>;
  mcpAuthorization(): McpAuthorization;
}
