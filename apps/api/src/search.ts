/**
 * The search request Códice sends AI Search and the results it returns (SPEC.md, "Query"). Pure:
 * the Worker routes, the MCP tool and the retrieval eval share it.
 */

import { IN_FORCE_UNTIL } from "./db/schema";

export { IN_FORCE_UNTIL };

export const SEARCH_LIMIT_DEFAULT = 5;

/**
 * Keep every reranked result. The default reranker scores Spanish passages low (a correct first
 * result at 0.34), so its default threshold of 0.4 emptied 4 of the eval's 50 answers; at 0 the
 * eval scores best (SPEC.md, "Retrieval eval"). Each result still carries its reranking score.
 */
export const RERANKING_THRESHOLD = 0;
/** The passage kinds (SPEC.md, "Items"); Phase 0 holds `guia` (the filling guides) and `anexo`. */
export const PASSAGE_KINDS = ["ley", "reglamento", "regla", "anexo", "guia", "criterio"] as const;
/** AI Search returns at most 50 results. */
export const SEARCH_LIMIT_MAX = 50;

const MEXICO_CITY_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** A date as Códice's `YYYYMMDD` number: `2026-10-24` becomes `20261024`. */
export function dateNumber(isoDate: string): number {
  return Number(isoDate.slice(0, 10).replaceAll("-", ""));
}

/** `20261024` back to `2026-10-24`. */
export function isoDate(date: number): string {
  const digits = String(date).padStart(8, "0");
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Today in Mexico City, the date the SAT's rules are read in, as `YYYYMMDD`. */
export function todayInMexicoCity(now: Date = new Date()): number {
  return dateNumber(MEXICO_CITY_DATE.format(now));
}

/** A calendar date `YYYY-MM-DD` that exists (no `2026-02-30`), or null. */
export function parseAsOf(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? dateNumber(value) : null;
}

export type SearchInput = {
  readonly q: string;
  /** `YYYYMMDD`: only passages in force that day. */
  readonly asOf: number;
  /** A source id, the passages' AI Search folder, such as `anexo-20-guia-de-llenado`. */
  readonly source?: string;
  /** A passage kind (SPEC.md, "Items"), such as `guia` for the filling guides' definitions. */
  readonly kind?: string;
  readonly limit: number;
  /** Overrides the instance's keyword match mode; the retrieval eval compares both. */
  readonly keywordMatchMode?: "and" | "or";
  /** Overrides `RERANKING_THRESHOLD`; the retrieval eval compares values. */
  readonly rerankingThreshold?: number;
};

/** The `search()` request: the question, the validity filter, and the source and kind when given. */
export function searchRequest(input: SearchInput) {
  return {
    messages: [{ role: "user" as const, content: input.q }],
    ai_search_options: {
      retrieval: {
        filters: {
          valid_from: { $lte: input.asOf },
          valid_until: { $gte: input.asOf },
          ...(input.source ? { folder: `${input.source}/` } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
        },
        max_num_results: input.limit,
        // AI Search otherwise answers a retrieval failure with no chunks, which reads as "no rule
        // applies"; throwing reaches the 502 `search_unavailable` instead.
        return_on_failure: false,
        ...(input.keywordMatchMode ? { keyword_match_mode: input.keywordMatchMode } : {}),
      },
      reranking: { match_threshold: input.rerankingThreshold ?? RERANKING_THRESHOLD },
    },
  } satisfies AiSearchSearchRequest;
}

export type SearchResult = {
  /** The AI Search item key, `<source>/<anchor>.md`. */
  readonly passageId: string;
  readonly source: string;
  /** The passage text, verbatim as indexed. */
  readonly quote: string;
  readonly authority: string | null;
  readonly kind: string | null;
  readonly validFrom: string | null;
  /** Null while the passage is in force. */
  readonly validUntil: string | null;
  readonly score: number;
  readonly scoring: {
    readonly keywordScore: number | null;
    readonly vectorScore: number | null;
    readonly rerankingScore: number | null;
  };
};

type SearchChunk = AiSearchSearchResponse["chunks"][number];

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function date(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? isoDate(value) : null;
}

/** An item's custom metadata (SPEC.md, "Items") as authority, kind and ISO validity dates. */
export function passageMetadata(metadata: Record<string, unknown> | undefined) {
  const validUntil = metadata?.["valid_until"];
  return {
    authority: text(metadata?.["authority"]),
    kind: text(metadata?.["kind"]),
    validFrom: date(metadata?.["valid_from"]),
    validUntil: validUntil === IN_FORCE_UNTIL ? null : date(validUntil),
  };
}

/** One result a chunk, in AI Search's order. */
export function searchResults(chunks: readonly SearchChunk[]): SearchResult[] {
  return chunks.map((chunk) => ({
    passageId: chunk.item.key,
    source: chunk.item.key.split("/")[0] ?? "",
    quote: chunk.text,
    ...passageMetadata(chunk.item.metadata),
    score: chunk.score,
    scoring: {
      keywordScore: chunk.scoring_details?.keyword_score ?? null,
      vectorScore: chunk.scoring_details?.vector_score ?? null,
      rerankingScore: chunk.scoring_details?.reranking_score ?? null,
    },
  }));
}
