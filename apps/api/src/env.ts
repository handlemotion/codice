import type { CodiceAccountsService } from "@codice/contracts";

// The generated CloudflareBindings types `secrets` as required strings and every binding as
// present. A local run has no SENTRY_DSN, and `/ready` must answer when a binding is missing, so the
// bindings the app checks are re-declared here as optional; Omit drops the generated entry so the
// redeclaration is not narrowed back.
interface CodiceBindingOverrides {
  ACCOUNTS?: Pick<CodiceAccountsService, "verifyApiKey" | "verifyAccessToken" | "mcpAuthorization">;
  CODICE_DATABASE?: D1Database;
  CODICE_SEARCH?: AiSearchInstance;
  CODICE_PUBLIC_RATE_LIMITER?: RateLimit;
  CODICE_CHAT_RATE_LIMITER?: RateLimit;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  SENTRY_DSN?: string;
  ANTHROPIC_API_KEY?: string;
  SENTRY_RELEASE?: string;
}

export type CodiceBindings = Omit<CloudflareBindings, keyof CodiceBindingOverrides> &
  CodiceBindingOverrides;

export type CodiceVariables = {
  requestId: string;
  /**
   * The verified caller of a `/v1` or `/mcp` route: a team's API key, or (on `/mcp` only) a user
   * through an MCP client they authorized by OAuth.
   */
  caller:
    | { kind: "api_key"; keyId: string; organizationId: string }
    | { kind: "oauth"; userId: string; clientId: string };
};

export type CodiceEnv = { Bindings: CodiceBindings; Variables: CodiceVariables };
