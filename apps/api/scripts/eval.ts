/**
 * Retrieval eval: each question in `eval-questions.json` must return one of its expected passages
 * in the top 3. Runs against the real AI Search instance `codice` with the Worker's own request
 * (`searchRequest`), so it measures what `/v1/search` returns (SPEC.md, "Testing").
 *
 *   pnpm --filter @codice/api eval                 the instance's keyword match mode
 *   pnpm --filter @codice/api eval --match or      override it for this run
 *   pnpm --filter @codice/api eval --rerank-threshold 0.1   override the reranking threshold
 *   pnpm --filter @codice/api eval --out run.json  also write every rank to a file
 *   pnpm --filter @codice/api eval --min-top3 47   exit 1 when fewer questions pass
 *   pnpm --filter @codice/api eval --instance codice-bge-m3   a comparison instance
 *
 * Runs under Doppler `codice` `dev`, whose `CODICE_AI_SEARCH_TOKEN` has AI Search Run and Read only;
 * without it, `CLOUDFLARE_API_TOKEN`. About 50 queries a run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { RERANKING_THRESHOLD, searchRequest, todayInMexicoCity } from "../src/search";
import { buildCorpus } from "./corpus";

const APP = resolve(import.meta.dirname, "..");
const ACCOUNT_ID = "2504eb0d24f17f6efbf89c1296a08389";
/** Results fetched per question: enough to see how far a miss fell. */
const DEPTH = 10;
const TOP = 3;

const { values } = parseArgs({
  options: {
    match: { type: "string" },
    "rerank-threshold": { type: "string" },
    out: { type: "string" },
    "min-top3": { type: "string" },
    instance: { type: "string", default: "codice" },
  },
});
const INSTANCE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/namespaces/default/instances/${values.instance}`;
if (values.match !== undefined && values.match !== "and" && values.match !== "or") {
  throw new Error("--match is `and` or `or`");
}
const match = values.match;
const rerankingThreshold =
  values["rerank-threshold"] === undefined ? undefined : Number(values["rerank-threshold"]);
const minTop3 = values["min-top3"] === undefined ? undefined : Number(values["min-top3"]);
if (minTop3 !== undefined && !Number.isInteger(minTop3)) {
  throw new Error("--min-top3 is a whole number of questions");
}

type Question = { readonly q: string; readonly expect: readonly string[] };

function token() {
  const value = process.env.CODICE_AI_SEARCH_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (!value) throw new Error("Set CODICE_AI_SEARCH_TOKEN (or CLOUDFLARE_API_TOKEN)");
  return value;
}

async function api<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${INSTANCE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json()) as { success: boolean; errors: unknown; result: T };
  if (!response.ok || !body.success) {
    throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body.errors)}`);
  }
  return body.result;
}

async function main() {
  const questions = JSON.parse(
    readFileSync(join(APP, "scripts/eval-questions.json"), "utf8"),
  ) as Question[];
  const corpus = buildCorpus({
    read: (file) => readFileSync(join(APP, "../../docs/sat-md", file), "utf8"),
  });
  const keys = new Set(corpus.passages.map((passage) => passage.key));
  const unknown = questions.flatMap((question) => question.expect.filter((key) => !keys.has(key)));
  if (unknown.length > 0)
    throw new Error(`Expected passages not in the corpus: ${unknown.join(", ")}`);

  const instance = await api<{
    embedding_model?: string;
    chunk_size?: number;
    indexing_options?: { keyword_tokenizer?: string };
    retrieval_options?: { keyword_match_mode?: string };
  }>("");
  const config = {
    instance: values.instance,
    embeddingModel: instance.embedding_model,
    chunkSize: instance.chunk_size,
    keywordTokenizer: instance.indexing_options?.keyword_tokenizer ?? "porter",
    keywordMatchMode: match ?? instance.retrieval_options?.keyword_match_mode ?? "and",
    rerankingThreshold: rerankingThreshold ?? RERANKING_THRESHOLD,
  };
  console.log(JSON.stringify(config));

  const asOf = todayInMexicoCity();
  const runs: { q: string; rank: number | null; top: string[] }[] = [];
  for (const question of questions) {
    const result = await api<AiSearchSearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify(
        searchRequest({
          q: question.q,
          asOf,
          limit: DEPTH,
          keywordMatchMode: match,
          rerankingThreshold,
        }),
      ),
    });
    const ranked = [...new Set(result.chunks.map((chunk) => chunk.item.key))];
    const index = ranked.findIndex((key) => question.expect.includes(key));
    const rank = index === -1 ? null : index + 1;
    runs.push({ q: question.q, rank, top: ranked.slice(0, TOP) });
    const mark = rank !== null && rank <= TOP ? "pass" : "MISS";
    console.log(`${mark} rank=${rank ?? "-"} ${question.q}`);
    if (mark === "MISS") console.log(`     top: ${ranked.slice(0, TOP).join(", ") || "(none)"}`);
  }

  const hits = runs.filter((run) => run.rank !== null && run.rank <= TOP).length;
  const first = runs.filter((run) => run.rank === 1).length;
  const mrr = runs.reduce((total, run) => total + (run.rank ? 1 / run.rank : 0), 0) / runs.length;
  const summary = {
    ...config,
    asOf,
    questions: runs.length,
    top3: hits,
    top1: first,
    mrr10: Number(mrr.toFixed(3)),
  };
  console.log(JSON.stringify(summary));
  if (values.out) writeFileSync(values.out, `${JSON.stringify({ summary, runs }, null, 2)}\n`);
  if (minTop3 !== undefined && hits < minTop3) {
    console.error(`Top 3: ${hits} of ${runs.length}, below the floor of ${minTop3}`);
    process.exitCode = 1;
  }
}

await main();
