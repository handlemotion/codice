import { isLoginRedirect, routeTarget } from "./route";

interface Env {
  API: Fetcher;
  APP: Fetcher;
  SITE: Fetcher;
  SITE_ENABLED?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const input = { url, method: request.method, siteEnabled: env.SITE_ENABLED };
    const target = routeTarget({ ...input, cookie: request.headers.get("cookie") });
    if (target === "api") return env.API.fetch(request);
    if (target === "site") return env.SITE.fetch(request);
    const response = await env.APP.fetch(request);
    // Only the session cookie sent this request to the app; if the app finds no session, the
    // visitor is anonymous and gets the site.
    if (routeTarget({ ...input, cookie: null }) === "site" && isLoginRedirect(response, url)) {
      await response.body?.cancel();
      return env.SITE.fetch(request);
    }
    return response;
  },
} satisfies ExportedHandler<Env>;
