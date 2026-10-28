import { createOpenAPI } from "fumadocs-openapi/server";

// Written by `pnpm --filter @codice/api openapi` from apps/api/src/openapi.ts. Imported rather
// than read from disk: the site runs in workerd, which has no filesystem.
import document from "../../content/openapi.json";

export const openapi = createOpenAPI({
  input: { codice: document as never },
});
