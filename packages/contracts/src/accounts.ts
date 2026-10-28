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
  /** Counts calls into the team's or the user's usage, which the dashboard's Uso page shows. */
  recordUsage(events: UsageEvent[]): Promise<void>;
}

/** Who made a `/v1` or `/mcp` call: a team's API key, or a user through an MCP client (OAuth). */
export type UsageCaller =
  | { kind: "api_key"; keyId: string; organizationId: string }
  | { kind: "oauth"; userId: string; clientId: string };

/**
 * One call to `/v1` or one MCP tool call, as `codice-api` reports it after answering
 * (apps/api/SPEC.md, "Usage"). `operation` names the handler the same way on both surfaces: the
 * MCP tool's name (`search`, `read_passage`…), which `/v1` routes map to.
 */
export interface UsageEvent {
  caller: UsageCaller;
  surface: "http" | "mcp";
  operation: string;
  /** The HTTP status `codice-api` answered with (for an MCP tool call, its `/mcp` request's). */
  status: number;
  durationMs: number;
  /** When the call arrived, epoch milliseconds. */
  at: number;
}
