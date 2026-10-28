import { defineDocs } from "fumadocs-mdx/macro";

// The docs' MDX (content/docs), compiled by fumadocs-mdx's Vite plugin. Pages load on demand, each
// with its Markdown for /llms-full.txt (src/lib/llms.ts).
export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true, postprocess: { includeProcessedMarkdown: { headingIds: false } } },
});
