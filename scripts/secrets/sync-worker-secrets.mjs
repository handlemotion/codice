#!/usr/bin/env node
// Sync Doppler `codice` `prd` to the secrets of every Códice Worker (`apps/*/wrangler.jsonc`).
//
//   node scripts/secrets/sync-worker-secrets.mjs                     # plan only
//   node scripts/secrets/sync-worker-secrets.mjs --apply             # upsert
//   node scripts/secrets/sync-worker-secrets.mjs --apply --prune     # upsert, delete the rest
//   node scripts/secrets/sync-worker-secrets.mjs --apply --since 2026-10-25T00:00:00Z
//
// Auth: the `doppler` CLI must already be authenticated (DOPPLER_TOKEN or `doppler oidc login`), and
// CLOUDFLARE_WORKER_SECRETS_TOKEN (Workers Scripts Edit, in `codice` `prd`) must be set: run it
// under `doppler run -p codice -c prd --`. Secret values are read only to apply, held in memory,
// and never printed; a dry run reads names only.
//
// Each Worker gets only the names it declares (`secrets.required` in its wrangler.jsonc): `prd`
// also holds the ingestion's and this sync's tokens, which must not reach a Worker. A Worker that
// declares none is skipped.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse } from "jsonc-parser";

const ACCOUNT_ID = "473fbe436e39d8f3d33b6bb09afd3dd7";
const CF = "https://api.cloudflare.com/client/v4";
const PROJECT = "codice";
const CONFIG = "prd";
const APPS = resolve(import.meta.dirname, "../../apps");

/** `{ script, keys }` for each app's wrangler.jsonc that declares required secrets. */
export function workers(appsDir = APPS) {
  const out = [];
  for (const app of readdirSync(appsDir).sort()) {
    let text;
    try {
      text = readFileSync(join(appsDir, app, "wrangler.jsonc"), "utf8");
    } catch {
      continue;
    }
    const config = parse(text);
    const keys = config.secrets?.required ?? [];
    if (keys.length > 0) out.push({ script: config.name, keys: [...keys].sort() });
  }
  return out;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const apply = flag("apply");
const prune = flag("prune");
const since = option("since") ? new Date(option("since")) : undefined;

function dopplerJson(cliArgs) {
  const out = execFileSync(
    "doppler",
    [...cliArgs, "-p", PROJECT, "-c", CONFIG, "--json", "--no-check-version"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(out);
}

// Names only unless `withValues`, so a dry run never reads a production value.
// Only the declared names are kept, so no other `prd` value stays in memory.
function dopplerSecrets(withValues, wanted) {
  const raw = dopplerJson(["secrets", ...(withValues ? [] : ["--only-names"])]);
  const out = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (wanted.has(key)) out[key] = entry.computed ?? entry;
  }
  return out;
}

function dopplerChangedAfter(date) {
  const logs = dopplerJson(["configs", "logs", "-n", "50"]);
  return logs.some((entry) => new Date(entry.created_at) > date);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cf(method, route, body, contentType = "application/json") {
  const token = process.env.CLOUDFLARE_WORKER_SECRETS_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_WORKER_SECRETS_TOKEN is not set");
  const res = await fetch(`${CF}${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const errors = (json.errors ?? []).map((e) => `${e.code} ${e.message}`).join("; ");
    throw new Error(`Cloudflare ${method} ${route} failed: ${res.status} ${errors}`);
  }
  return json.result;
}

// Secret writes propagate asynchronously; poll briefly before declaring a mismatch.
async function waitForNames(base, expected) {
  let after = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    after = (await cf("GET", `${base}/secrets`)).map((s) => s.name).sort();
    if (JSON.stringify(after) === JSON.stringify(expected)) return after;
    await sleep(2000);
  }
  throw new Error(`names after sync differ from expected: got ${after.join(" ")}`);
}

async function syncWorker({ script, keys: declared }, source) {
  const base = `/accounts/${ACCOUNT_ID}/workers/scripts/${script}`;
  const desired = Object.fromEntries(
    declared.filter((k) => k in source).map((k) => [k, source[k]]),
  );
  const keys = Object.keys(desired).sort();
  if (keys.length === 0) {
    console.log(`${script}: Doppler ${PROJECT}/${CONFIG} has no ${declared.join(" ")}, skipped`);
    return;
  }
  const current = (await cf("GET", `${base}/secrets`)).map((s) => s.name).sort();
  const added = keys.filter((k) => !current.includes(k));
  const stale = current.filter((k) => !keys.includes(k));
  console.log(
    `${script}: upsert ${keys.length} (${added.length} new${added.length ? `: ${added.join(" ")}` : ""}), stale ${stale.length}${stale.length ? `: ${stale.join(" ")}` : ""}${prune ? "" : stale.length ? " (kept; pass --prune)" : ""}`,
  );
  if (!apply) return;

  // One merge-patch = one new Worker version (auto-deployed when the latest version is live).
  // Same wire format as `wrangler secret bulk`: null removes a secret.
  const patch = {};
  for (const name of keys) patch[name] = { name, text: desired[name], type: "secret_text" };
  if (prune) for (const name of stale) patch[name] = null;
  await cf("PATCH", `${base}/secrets-bulk`, { secrets: patch }, "application/merge-patch+json");

  const expected = prune ? keys : [...new Set([...keys, ...stale])].sort();
  const after = await waitForNames(base, expected);
  console.log(`${script}: applied, ${after.length} secrets bound`);
}

async function main() {
  const targets = workers();
  console.log(`${apply ? "APPLY" : "DRY RUN"} · ${targets.map((w) => w.script).join(" ")}`);
  if (since && !dopplerChangedAfter(since)) {
    console.log(`no Doppler ${PROJECT}/${CONFIG} activity since ${since.toISOString()}, skipped`);
    return;
  }
  const source = dopplerSecrets(apply, new Set(targets.flatMap((w) => w.keys)));
  for (const target of targets) await syncWorker(target, source);
}

if (import.meta.main)
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
