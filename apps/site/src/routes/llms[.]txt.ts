import { createFileRoute } from "@tanstack/react-router";

import { llmsIndex } from "../lib/llms";

// llms.txt (llmstxt.org): the docs' index for AI assistants. The edge routes it to the site.
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(llmsIndex(), { headers: { "content-type": "text/markdown; charset=utf-8" } }),
    },
  },
});
