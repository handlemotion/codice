import { spawn } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function runPnpm(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", args, {
      cwd,
      // CI keeps Wrangler from asking to confirm the execute.
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) =>
      resolve({ code: 1, stdout, stderr: `${stderr}${error.message}` }),
    );
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

// Wrangler's `--json` output is an array with one result set per statement.
export function errorCodeCount(output) {
  const [statement] = JSON.parse(output);
  const count = statement?.results?.[0]?.count;
  if (!Number.isSafeInteger(count)) throw new Error("local Códice D1 returned no error-code count");
  return count;
}

// Loads the corpus records into Códice's local D1 (`ingest --local`) when it holds none, so a fresh
// checkout's `wrangler dev` answers `/v1/errors` and `/v1/catalogs`. Local only: it never reaches AI
// Search or the remote database. Run after the local migrations, which create the tables.
export async function seedLocalCodiceRecords(options = {}) {
  const cwd = path.join(options.root ?? repoRoot, "apps", "api");
  const run = options.run ?? runPnpm;
  const counted = await run(
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "CODICE_DATABASE",
      "--local",
      "--json",
      "--command",
      "SELECT count(*) AS count FROM error_codes",
    ],
    cwd,
  );
  if (counted.code !== 0) return { seeded: false, error: counted.stderr.trim() || counted.stdout };
  let count;
  try {
    count = errorCodeCount(counted.stdout);
  } catch (error) {
    return { seeded: false, error: error.message };
  }
  if (count > 0) return { seeded: false };
  const ingested = await run(["exec", "tsx", "scripts/ingest.ts", "--local"], cwd);
  if (ingested.code !== 0) {
    return { seeded: false, error: `${ingested.stdout}${ingested.stderr}`.trim() };
  }
  return { seeded: true, summary: ingested.stdout.trim().split("\n").at(-1) };
}

export function describeCodiceSeedResult({ seeded, summary, error }) {
  if (error) return `codice D1 CODICE_DATABASE: local records seed failed\n${error}`;
  if (seeded) return `codice D1 CODICE_DATABASE: seeded local records (${summary})`;
  return "codice D1 CODICE_DATABASE: local records present";
}
