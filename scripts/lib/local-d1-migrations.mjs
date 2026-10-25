import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "jsonc-parser";

const repoRoot = path.resolve(import.meta.dirname, "../..");

// Every local D1 database with a migrations directory, read from each app's `wrangler.jsonc`.
export function localD1MigrationTargets(root = repoRoot) {
  const appsDirectory = path.join(root, "apps");
  return readdirSync(appsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name: app }) => {
      const configPath = path.join(appsDirectory, app, "wrangler.jsonc");
      if (!existsSync(configPath)) return [];
      const config = parse(readFileSync(configPath, "utf8"), [], { allowTrailingComma: true });
      return (config?.d1_databases ?? []).flatMap(({ binding, migrations_dir }) =>
        binding && migrations_dir ? [{ app, binding }] : [],
      );
    });
}

// Wrangler prints "No migrations to apply!" or tables that name each migration it applied.
export function appliedMigrationNames(output) {
  if (/No migrations to apply!/u.test(output)) return [];
  return [...new Set(output.match(/\b\d{4}_[\w-]+\.sql\b/gu) ?? [])];
}

function runWrangler(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["exec", "wrangler", ...args], {
      cwd,
      // CI keeps Wrangler from asking to confirm the apply.
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", (error) => resolve({ code: 1, output: `${output}${error.message}` }));
    child.once("exit", (code) => resolve({ code, output }));
  });
}

// Applies pending migrations to the local D1 files only (`--local`, Wrangler's default persistence
// in `apps/<app>/.wrangler/state`, the same files `wrangler dev` serves). Migrations are additive:
// nothing is dropped or recreated.
export async function applyLocalD1Migrations(targets, options = {}) {
  const root = options.root ?? repoRoot;
  const run = options.run ?? runWrangler;
  return Promise.all(
    targets.map(async ({ app, binding }) => {
      const { code, output } = await run(
        ["d1", "migrations", "apply", binding, "--local", "--config", "wrangler.jsonc"],
        path.join(root, "apps", app),
      );
      if (code !== 0) return { app, binding, applied: [], error: output.trim() };
      return { app, binding, applied: appliedMigrationNames(output) };
    }),
  );
}

export function describeD1MigrationResult({ app, binding, applied, error }) {
  if (error) return `${app} D1 ${binding}: local migrations failed\n${error}`;
  if (applied.length === 0) return `${app} D1 ${binding}: local migrations up to date`;
  return `${app} D1 ${binding}: applied ${applied.join(", ")}`;
}
