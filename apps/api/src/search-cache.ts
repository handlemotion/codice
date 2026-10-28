/**
 * Repeated searches from the data center's cache instead of AI Search (SPEC.md, "Search cache").
 * An entry is the chunks AI Search returned for one exact search input, keyed with the corpus
 * version, so an ingestion's change misses within `SOURCES_CACHE_MS` and the entry ages out after
 * `SEARCH_CACHE_SECONDS`. The Cache API keeps entries per data center and serves every caller of
 * `search()`: `/v1/search`, `/mcp`, `POST /v1/chat` and the `CodiceKnowledge` entrypoint.
 */

import type { SearchInput } from "./search";
import { measured } from "./timing";

/** How long an entry lives; bounds a result cached while AI Search still indexed an ingestion. */
export const SEARCH_CACHE_SECONDS = 60 * 60;

const CACHE_NAME = "codice-search";

type Chunks = AiSearchSearchResponse["chunks"];

/** The entry's key: the corpus version and every input `searchRequest` reads, never the caller. */
export function searchCacheKey(input: SearchInput, version: string): string {
  const parameters = new URLSearchParams({
    q: input.q,
    asOf: String(input.asOf),
    source: input.sources?.join(",") ?? "",
    kind: input.kind ?? "",
    limit: String(input.limit),
  });
  return `https://search-cache.codice.internal/${version}?${parameters}`;
}

/** The cached chunks for `key`, else `run`'s, stored. A failure of `run` is not stored. */
export async function cachedChunks(key: string, run: () => Promise<Chunks>): Promise<Chunks> {
  const cache = await caches.open(CACHE_NAME);
  const hit = await measured("cache", { op: "cache.get", name: "Search cache match" }, () =>
    cache.match(key),
  );
  if (hit) return (await hit.json()) as Chunks;
  const chunks = await run();
  await measured("cache", { op: "cache.put", name: "Search cache put" }, () =>
    cache.put(
      key,
      new Response(JSON.stringify(chunks), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${SEARCH_CACHE_SECONDS}`,
        },
      }),
    ),
  );
  return chunks;
}
