/**
 * Writes the public API's OpenAPI document (src/openapi.ts) where the docs read it:
 * `apps/site/content/openapi.json`. Run after changing a /v1 route or its schema:
 *
 *   pnpm --filter @codice/api openapi
 *
 * test/openapi.test.ts fails while the written file differs from the document.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openApiDocument } from "../src/openapi";

export const OPENAPI_PATH = fileURLToPath(
  new URL("../../site/content/openapi.json", import.meta.url).href,
);

writeFileSync(OPENAPI_PATH, `${JSON.stringify(openApiDocument(), null, 2)}\n`);
console.log(`Wrote ${OPENAPI_PATH}`);
