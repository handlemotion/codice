import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";

import { source } from "../../lib/source";

// The docs' search, under `/_site/` like everything of the site's that is not a page (apps/edge).
const server = createFromSource(source, { language: "spanish" });

export const Route = createFileRoute("/_site/search")({
  server: { handlers: { GET: async ({ request }) => server.GET(request) } },
});
