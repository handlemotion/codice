export type RouteTarget = "api" | "app" | "site";

export const SESSION_COOKIE = "__Secure-codice-session";
export const SITE_ASSET_PREFIX = "/_site/";
/**
 * The public API (`apps/api`): `/v1`, `/mcp` and their subpaths, any method, and `/mcp`'s OAuth
 * protected resource metadata (RFC 9728), at the root and at `/mcp`. The authorization server's
 * own metadata, `/.well-known/oauth-authorization-server/api/auth`, is the app's.
 */
export const API_PREFIXES: readonly string[] = [
  "/v1",
  "/mcp",
  "/.well-known/oauth-protected-resource",
];
/** The API's probes, answered on the public host too. */
export const API_PATHS: ReadonlySet<string> = new Set(["/health", "/ready"]);

/** The site's own pages besides `/`: the docs, for every visitor, signed in or not. */
export const SITE_PAGE_PREFIXES: readonly string[] = ["/docs"];

/** `/?site` serves the site to a signed-in visitor too: the dashboard's "Website" link uses it. */
export const SITE_HOME_PARAM = "site";

export interface RouteInput {
  url: URL;
  method: string;
  cookie: string | null;
  siteEnabled: string | undefined;
}

function isApiPath(pathname: string): boolean {
  if (API_PATHS.has(pathname)) return true;
  return API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isSitePage(pathname: string): boolean {
  return SITE_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function hasSession(cookie: string | null): boolean {
  if (!cookie) return false;
  return cookie.split(";").some((pair) => {
    const separator = pair.indexOf("=");
    if (separator < 0) return false;
    return pair.slice(0, separator).trim() === SESSION_COOKIE && pair.slice(separator + 1).trim();
  });
}

// The API owns its prefixes regardless of method or session. The site owns `/` for anonymous
// visitors, its pages (`/docs`) for everyone and its hashed assets; every other path is the
// dashboard's, so the app stays the default.
export function routeTarget({ url, method, cookie, siteEnabled }: RouteInput): RouteTarget {
  if (isApiPath(url.pathname)) return "api";
  if (siteEnabled !== "true") return "app";
  if (url.pathname.startsWith(SITE_ASSET_PREFIX)) return "site";
  if (method !== "GET" && method !== "HEAD") return "app";
  if (isSitePage(url.pathname)) return "site";
  if (url.pathname !== "/") return "app";
  if (url.searchParams.has(SITE_HOME_PARAM)) return "site";
  return hasSession(cookie) ? "app" : "site";
}

// The cookie outlives its session (expiry, sign-out, an unfinished sign-in), so only the app knows
// whether `/` is signed in. When it answers `/` by sending the visitor to `/login`, the visitor is
// anonymous and gets the site instead.
export function isLoginRedirect(response: Response, requestUrl: URL): boolean {
  if (response.status < 300 || response.status > 399) return false;
  const location = response.headers.get("location");
  if (!location) return false;
  const target = new URL(location, requestUrl);
  return target.origin === requestUrl.origin && target.pathname === "/login";
}
