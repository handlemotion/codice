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
/** The passage kinds (SPEC.md, "Items"); the corpus holds `guia` (the filling guides), `anexo` and `regla` (the RMF). */
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
  /** Overrides the instance's reranking and query rewriting; the retrieval eval compares them. */
  readonly reranking?: boolean;
  readonly queryRewrite?: boolean;
};

/**
 * The passages in force on `asOf`: those whose validity, `valid_from` to `valid_until`, holds it. A
 * superseded passage ends the day before its successor starts, so each day meets one version.
 */
export function validityFilter(asOf: number) {
  return { valid_from: { $lte: asOf }, valid_until: { $gte: asOf } };
}

/** The `search()` request: the question, the validity filter, and the source and kind when given. */
export function searchRequest(input: SearchInput) {
  return {
    messages: [{ role: "user" as const, content: input.q }],
    ai_search_options: {
      retrieval: {
        filters: {
          ...validityFilter(input.asOf),
          ...(input.source ? { folder: `${input.source}/` } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
        },
        max_num_results: input.limit,
        // AI Search otherwise answers a retrieval failure with no chunks, which reads as "no rule
        // applies"; throwing reaches the 502 `search_unavailable` instead.
        return_on_failure: false,
        ...(input.keywordMatchMode ? { keyword_match_mode: input.keywordMatchMode } : {}),
      },
      reranking: {
        match_threshold: input.rerankingThreshold ?? RERANKING_THRESHOLD,
        ...(input.reranking === undefined ? {} : { enabled: input.reranking }),
      },
      ...(input.queryRewrite === undefined
        ? {}
        : { query_rewrite: { enabled: input.queryRewrite } }),
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

/** What a search returns per passage: `full` quotes the matched text, `brief` an excerpt of it. */
export const SEARCH_FORMATS = ["full", "brief"] as const;
export type SearchFormat = (typeof SEARCH_FORMATS)[number];

/** A brief result's excerpt at most, in characters: about 80 tokens of the SAT's Spanish. */
export const EXCERPT_LENGTH = 320;
/** How much text an excerpt keeps before the first term it matched. */
const EXCERPT_LEAD = 60;

/** Words too common to place an excerpt by, folded; a word under 3 letters never counts. */
const STOPWORDS = new Set(
  (
    "las los del con por para una uno unos unas que como cual cuando donde debe puede este esta " +
    "esto ese esa sus the and for with what when how does are can"
  ).split(" "),
);

/** Lowercase without accents and as long as `text`, so an index in one is an index in the other. */
function folded(text: string) {
  let out = "";
  for (const character of text) {
    const base = character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += base.length === character.length ? base : character;
  }
  return out;
}

/** The question's words worth matching, folded: `¿Qué UsoCFDI lleva…?` → `usocfdi`, `lleva`. */
export function excerptTerms(q: string): string[] {
  const words = folded(q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
  return [...new Set(words)];
}

export type Excerpt = {
  /** An exact substring of the passage's text, never rewritten. */
  readonly excerpt: string;
  /** Whether the passage's text continues before or after the excerpt. */
  readonly truncated: { readonly before: boolean; readonly after: boolean };
};

const SPACE = /\s/u;

/**
 * At most `length` characters of `text` around the part that matches `q`: the window that holds
 * the most distinct terms of the question, starting a little before the first, snapped to whole
 * words. Without a matching term (a match by meaning) it is the text's start. Never paraphrased:
 * the excerpt is `text.slice(start, end)`.
 */
export function excerpt(text: string, q: string, length = EXCERPT_LENGTH): Excerpt {
  const haystack = folded(text);
  const hits = excerptTerms(q)
    .flatMap((term) => {
      const found: { at: number; term: string }[] = [];
      for (let at = haystack.indexOf(term); at !== -1; at = haystack.indexOf(term, at + 1)) {
        found.push({ at, term });
      }
      return found;
    })
    .sort((a, b) => a.at - b.at);
  let best = { at: 0, terms: 0, hits: 0 };
  for (const hit of hits) {
    const inside = hits.filter(
      (other) => other.at >= hit.at && other.at < hit.at + length - EXCERPT_LEAD,
    );
    const terms = new Set(inside.map((other) => other.term)).size;
    if (terms > best.terms || (terms === best.terms && inside.length > best.hits)) {
      best = { at: hit.at, terms, hits: inside.length };
    }
  }
  // From the start of the line or sentence of the first term when it is near, else from a little
  // before the term; earlier when the text ends before the window would. Then at a whole word.
  const opening = Math.max(text.lastIndexOf("\n", best.at), text.lastIndexOf(". ", best.at));
  let start = opening >= best.at - 2 * EXCERPT_LEAD ? opening + 1 : best.at - EXCERPT_LEAD;
  start = Math.max(0, Math.min(start, text.length - length));
  if (start > 0 && !SPACE.test(text[start - 1]!)) {
    const space = text.slice(start, best.at).search(/\s/u);
    if (space >= 0) start += space + 1;
  }
  let end = Math.min(text.length, start + length);
  // Back from a cut last word.
  if (end < text.length && !SPACE.test(text[end]!)) {
    const space = text.slice(start, end).search(/\s\S*$/u);
    if (space > 0) end = start + space;
  }
  while (start < end && SPACE.test(text[start]!)) start += 1;
  while (end > start && SPACE.test(text[end - 1]!)) end -= 1;
  return {
    excerpt: text.slice(start, end),
    truncated: {
      before: text.slice(0, start).trim() !== "",
      after: text.slice(end).trim() !== "",
    },
  };
}

/** A heading line `# …` opens every passage's text (SPEC.md, "Items"); the brief gives it apart. */
const HEADING_LINE = /^# [^\n]*\n+/u;

export type BriefSearchResult = Pick<
  SearchResult,
  "passageId" | "kind" | "validFrom" | "validUntil" | "score"
> &
  Excerpt & {
    /** The passage's heading path, such as `Anexo 20 › Nodo: Receptor › UsoCFDI`. */
    readonly heading: string | null;
  };

/** A result as its heading path and an excerpt of its quote around what `q` matched. */
export function briefResult(result: SearchResult, q: string, heading: string | null) {
  const text = result.quote.replace(HEADING_LINE, "");
  return {
    passageId: result.passageId,
    heading,
    ...excerpt(text, q),
    kind: result.kind,
    validFrom: result.validFrom,
    validUntil: result.validUntil,
    score: result.score,
  } satisfies BriefSearchResult;
}
