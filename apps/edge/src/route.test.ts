import { describe, expect, it } from "vitest";

import { isLoginRedirect, routeTarget } from "./route";

const SESSION = "__Secure-codice-session";

function target(
  path: string,
  options: { cookie?: string; method?: string; enabled?: string | undefined } = {},
) {
  return routeTarget({
    url: new URL(`https://codice.io${path}`),
    method: options.method ?? "GET",
    cookie: options.cookie ?? null,
    siteEnabled: "enabled" in options ? options.enabled : "true",
  });
}

describe("edge routing", () => {
  it("sends the API's paths to the API for any method, session or switch", () => {
    for (const path of [
      "/v1",
      "/v1/search?q=iva",
      "/v1/passages/a/b",
      "/mcp",
      "/mcp/x",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
      "/health",
      "/ready",
    ]) {
      expect(target(path)).toBe("api");
      expect(target(path, { method: "POST", cookie: `${SESSION}=sealed` })).toBe("api");
      expect(target(path, { enabled: "false" })).toBe("api");
    }
  });

  it("does not widen the API prefixes", () => {
    for (const path of [
      "/v1x",
      "/v2/search",
      "/mcpx",
      "/x/v1",
      "/V1",
      "/ready/x",
      "/healthz",
      "/.well-known/oauth-authorization-server/api/auth",
      "/.well-known/oauth-protected-resourcex",
    ]) {
      expect(target(path)).not.toBe("api");
    }
  });

  it("sends everything else to the app while the site switch is off", () => {
    for (const enabled of [undefined, "", "false", "TRUE", "1", " true"]) {
      expect(target("/", { enabled })).toBe("app");
      expect(target("/_site/app.js", { enabled })).toBe("app");
    }
  });

  it("sends anonymous visitors on / to the site and signed-in visitors to the app", () => {
    expect(target("/")).toBe("site");
    expect(target("/?utm_source=x")).toBe("site");
    expect(target("/", { cookie: `${SESSION}=sealed` })).toBe("app");
    expect(target("/", { cookie: `a=1; ${SESSION}=sealed; b=2` })).toBe("app");
  });

  it("only treats a non-empty cookie with the exact session name as a session", () => {
    expect(target("/", { cookie: `${SESSION}=` })).toBe("site");
    expect(target("/", { cookie: `other=${SESSION}` })).toBe("site");
    expect(target("/", { cookie: `x${SESSION}=sealed` })).toBe("site");
    expect(target("/", { cookie: "garbage;;=; ==" })).toBe("site");
  });

  it("serves the site on /?site even with a session", () => {
    expect(target("/?site", { cookie: `${SESSION}=sealed` })).toBe("site");
    expect(target("/?site", { cookie: `${SESSION}=sealed`, method: "POST" })).toBe("app");
    expect(target("/keys?site", { cookie: `${SESSION}=sealed` })).toBe("app");
  });

  it("serves site assets from the site regardless of session", () => {
    expect(target("/_site/app.js")).toBe("site");
    expect(target("/_site/app.js", { cookie: `${SESSION}=sealed` })).toBe("site");
    for (const path of ["/_site", "/_sitefoo", "/x/_site/a.js", "/_Site/a.js"]) {
      expect(target(path)).toBe("app");
    }
  });

  it("serves the docs from the site to everyone, for GET and HEAD", () => {
    for (const path of [
      "/docs",
      "/docs/",
      "/docs/api",
      "/docs/api/search?x=1",
      "/docs/guias/mcp",
    ]) {
      expect(target(path)).toBe("site");
      expect(target(path, { cookie: `${SESSION}=sealed` })).toBe("site");
      expect(target(path, { method: "HEAD" })).toBe("site");
      expect(target(path, { method: "POST" })).toBe("app");
      expect(target(path, { enabled: "false" })).toBe("app");
    }
  });

  it("does not widen the docs prefix", () => {
    for (const path of ["/docsx", "/doc", "/x/docs", "/Docs"]) expect(target(path)).toBe("app");
  });

  it("serves llms.txt and llms-full.txt from the site to everyone, for GET and HEAD", () => {
    for (const path of ["/llms.txt", "/llms-full.txt"]) {
      expect(target(path)).toBe("site");
      expect(target(path, { cookie: `${SESSION}=sealed` })).toBe("site");
      expect(target(path, { method: "HEAD" })).toBe("site");
      expect(target(path, { method: "POST" })).toBe("app");
      expect(target(path, { enabled: "false" })).toBe("app");
    }
    for (const path of ["/llms.txt/x", "/llms", "/x/llms.txt", "/LLMS.txt"]) {
      expect(target(path)).toBe("app");
    }
  });

  it("sends only GET and HEAD on / to the site", () => {
    expect(target("/", { method: "HEAD" })).toBe("site");
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      expect(target("/", { method })).toBe("app");
    }
  });

  it("sends every other path to the app, signed in or not", () => {
    for (const path of ["/login", "/keys", "/usage", "/assets/main.js", "//", "/index.html"]) {
      expect(target(path)).toBe("app");
      expect(target(path, { cookie: `${SESSION}=sealed` })).toBe("app");
    }
  });
});

describe("login redirect", () => {
  const root = new URL("https://codice.io/");
  const redirect = (location: string | null, status = 307) =>
    new Response(null, { status, headers: location ? { location } : {} });

  it("recognizes the app sending a cookie holder without a session to /login", () => {
    expect(isLoginRedirect(redirect("/login"), root)).toBe(true);
    expect(isLoginRedirect(redirect("https://codice.io/login"), root)).toBe(true);
    expect(isLoginRedirect(redirect("/login?next=%2F", 302), root)).toBe(true);
  });

  it("keeps every other app answer", () => {
    expect(isLoginRedirect(redirect("/keys"), root)).toBe(false);
    expect(isLoginRedirect(redirect("/login/x"), root)).toBe(false);
    expect(isLoginRedirect(redirect("https://evil.example/login"), root)).toBe(false);
    expect(isLoginRedirect(redirect(null), root)).toBe(false);
    expect(isLoginRedirect(new Response("ok", { headers: { location: "/login" } }), root)).toBe(
      false,
    );
  });
});
