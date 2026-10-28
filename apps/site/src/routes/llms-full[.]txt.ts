import { createFileRoute } from "@tanstack/react-router";

import { llmsFull } from "../lib/llms";

// Every guide in one Markdown file, for assistants that read the docs whole (llms.txt links it).
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () =>
        new Response(await llmsFull(), {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        }),
    },
  },
});
