import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { openApiDocument } from "../src/openapi";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url).href), "utf8");

// Hono's `:name` and `:name{regex}` become OpenAPI's `{name}`.
const toOpenApiPath = (path: string) => path.replace(/:(\w+)(\{[^}]*\})?/gu, "{$1}");

describe("OpenAPI document", () => {
  it("is what the docs read: run `pnpm --filter @codice/api openapi` after changing it", () => {
    const written = JSON.parse(read("../../site/content/openapi.json"));
    expect(written).toEqual(JSON.parse(JSON.stringify(openApiDocument())));
  });

  it("describes every public /v1 route, and only those", () => {
    const routes = [...read("../src/index.ts").matchAll(/app\.(get|post)\("(\/v1\/[^"]+)"/gu)]
      .map(([, method, path]) => `${method} ${toOpenApiPath(path!)}`)
      // The site's own chat endpoint is not part of the public API.
      .filter((route) => route !== "post /v1/chat")
      .sort();
    const documented = Object.entries(openApiDocument().paths)
      .flatMap(([path, operations]) => Object.keys(operations).map((method) => `${method} ${path}`))
      .sort();
    expect(documented).toEqual(routes);
  });
});
