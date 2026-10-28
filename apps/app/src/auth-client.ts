import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser's client of `/api/auth/*`, used by the sign-in and consent pages.
 * `oauthProviderClient` sends the page's signed authorization query (`oauth_query`) with each
 * sign-in, so signing in during an MCP client's authorization resumes it.
 */
export const authClient = createAuthClient({ plugins: [emailOTPClient(), oauthProviderClient()] });

/** The login or consent page was opened by `/api/auth/oauth2/authorize`, with its signed query. */
export function inAuthorization() {
  return new URLSearchParams(window.location.search).has("sig");
}
