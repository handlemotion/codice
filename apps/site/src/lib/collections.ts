import { defineDocs } from "fumadocs-mdx/macro";

// The docs' MDX (content/docs), compiled by fumadocs-mdx's Vite plugin. Pages load on demand.
export const docs = defineDocs({
  dir: "content/docs",
  docs: { async: true },
});
