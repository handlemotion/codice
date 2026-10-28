import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { createAuth } from "../../server/auth";

/**
 * The dashboard's chat, `POST /api/chat`: for a signed-in user only, it sends the turn to the
 * API's `POST /v1/chat` over the `API` service binding with the dashboard's own key
 * (`CODICE_APP_API_KEY`), as the site does with its key, so no key reaches the browser. The API
 * limits chat turns per address, so the address goes along.
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await createAuth(env).api.getSession({ headers: request.headers });
        if (!session) return Response.json({ code: "unauthorized" }, { status: 401 });
        // Optional, so it is not in the generated bindings (wrangler.jsonc, "secrets").
        const key = (env as { CODICE_APP_API_KEY?: string }).CODICE_APP_API_KEY;
        if (!key) {
          return Response.json({ code: "chat_unavailable" }, { status: 503 });
        }
        const headers = new Headers({
          authorization: `Bearer ${key}`,
          "content-type": request.headers.get("content-type") ?? "application/json",
        });
        for (const name of ["cf-connecting-ip", "x-request-id"]) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        return env.API.fetch("https://codice-api/v1/chat", {
          method: "POST",
          headers,
          body: request.body,
        });
      },
    },
  },
});
