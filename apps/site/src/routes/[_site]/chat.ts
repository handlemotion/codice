import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

/**
 * The demo chat's endpoint, `POST /_site/chat`: it sends the visitor's turn to the API's
 * `POST /v1/chat` over the `API` service binding with the site's own key (`CODICE_SITE_API_KEY`),
 * so the key never reaches the browser. The API limits chat turns per visitor's address, so the
 * address goes along.
 */
export const Route = createFileRoute("/_site/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!env.CODICE_SITE_API_KEY) {
          return Response.json({ code: "chat_unavailable" }, { status: 503 });
        }
        const headers = new Headers({
          authorization: `Bearer ${env.CODICE_SITE_API_KEY}`,
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
