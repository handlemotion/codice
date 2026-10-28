import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";

/**
 * The transport `cimd()` fetches an MCP client's metadata document (and its `jwks_uri`) with: the
 * `client_id` is an HTTPS URL the client chose, so the fetch must not reach anything private.
 *
 * Better Auth's Node transport pins the resolved address because a Node server can reach its own
 * network. A Worker cannot: its subrequests leave from Cloudflare's edge, which refuses IP-literal
 * URLs and Cloudflare-owned addresses, and `codice-app` has no private network or metadata
 * service behind it. `global_fetch_strictly_public` (wrangler.jsonc) also keeps the fetch off this
 * account's own zones and Workers. Before this runs, `cimd()` refuses a `client_id` whose host is
 * loopback, private or link-local; here, only HTTPS GET or HEAD, and a redirect fails the fetch.
 */
export const fetchClientMetadataResource: ClientMetadataResourceFetch = async (input, init) => {
  // `cimd()` asks for `redirect: "error"`, which a Worker's `Request` does not take: fetch with
  // `manual` and fail on a redirect as "error" would.
  const { redirect: _, ...rest } = init ?? {};
  const request = new Request(input, rest);
  if (new URL(request.url).protocol !== "https:") {
    throw new TypeError("Client metadata must be fetched over HTTPS");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new TypeError("Client metadata is fetched with GET or HEAD only");
  }
  const response = await fetch(request, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new TypeError("Client metadata fetch refused a redirect");
  }
  return response;
};
