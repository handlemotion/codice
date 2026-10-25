#!/usr/bin/env node
/**
 * One idempotent command that leaves this checkout with Códice running, so verification evidence
 * always comes from a running server:
 *
 *   pnpm dev:up                    # reuse or start `pnpm dev`
 *   pnpm dev:up -- --timeout 900   # seconds to wait for readiness (default 600)
 *
 * When this checkout already has an active `pnpm dev` run it is reused, never duplicated.
 * Otherwise `pnpm dev` starts detached (it keeps running after this command exits) and logs to
 * `.local/dev-stack.log`. Ready means `https://codice.local.transitive.app/ready` answers 200.
 * Pending local D1 migrations are then applied (a started runtime also applies its own, and seeds
 * the local records, before it starts). Stop the stack with `kill -TERM -<pid>` using the pid this
 * command prints.
 */
import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { codiceProbe, probe } from "./lib/dev-stack-probes.mjs";
import {
  applyLocalD1Migrations,
  describeD1MigrationResult,
  localD1MigrationTargets,
} from "./lib/local-d1-migrations.mjs";
import { reexecWithPortlessCa } from "./portless-ca.mjs";
import {
  cloudWorkspaceConductorPort,
  readOwner,
  workspaceDevLockPort,
} from "./workspace-dev-lifecycle.mjs";

reexecWithPortlessCa(fileURLToPath(import.meta.url));

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const timeoutMs = Number(argValue("timeout") ?? 600) * 1000;
const workspacePath = process.cwd();
const logPath = join(workspacePath, ".local", "dev-stack.log");
const lockPort = workspaceDevLockPort(workspacePath, cloudWorkspaceConductorPort(process.env));
const codice = codiceProbe();

function tail(path, lines = 40) {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

let owner = await readOwner(lockPort);
let started = null;
if ((await probe(codice)) !== null && owner === null) {
  await mkdir(join(workspacePath, ".local"), { recursive: true });
  const log = await open(logPath, "a");
  const child = spawn("pnpm", ["dev"], {
    cwd: workspacePath,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
    env: process.env,
  });
  child.unref();
  await log.close();
  started = { pid: child.pid, exited: null };
  child.once("exit", (code, signal) => {
    started.exited = signal ?? `code ${code}`;
  });
  console.log(`started pnpm dev (pid ${child.pid}); log: ${logPath}`);
} else if (owner !== null) {
  console.log(`reusing the active dev run (pid ${owner.pid ?? "unknown"})`);
}

const deadline = Date.now() + timeoutMs;
let lastReport = 0;
while (true) {
  const failure = await probe(codice);
  if (failure === null) break;
  if (started?.exited && (await readOwner(lockPort)) !== null) {
    // A concurrent `dev:up` won the dev lock first; wait on its run instead.
    console.log("another dev run holds this checkout's lock; waiting on it");
    started = null;
  } else if (started?.exited) {
    console.error(`pnpm dev exited before readiness (${started.exited}). Last log lines:`);
    console.error(tail(logPath));
    process.exit(1);
  }
  if (!started && (await readOwner(lockPort)) === null) {
    console.error("the dev run this command was waiting on stopped; rerun pnpm dev:up");
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error(`codice not ready after ${timeoutMs / 1000}s: ${failure}`);
    console.error(tail(logPath));
    process.exit(1);
  }
  if (Date.now() - lastReport > 15_000) {
    lastReport = Date.now();
    console.log(`waiting for codice=${failure}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
owner = await readOwner(lockPort);

// A reused run keeps its runtime, so migrations that arrived since it started (a merge of `main`)
// are applied here. Local and additive only: nothing is dropped or recreated.
const migrationResults = await applyLocalD1Migrations(localD1MigrationTargets(workspacePath), {
  root: workspacePath,
});
for (const result of migrationResults) {
  (result.error ? console.error : console.log)(describeD1MigrationResult(result));
}
if (migrationResults.some((result) => result.error)) process.exit(1);

console.log(
  JSON.stringify(
    {
      ready: true,
      devRunPid: owner?.pid ?? started?.pid ?? null,
      log: started ? logPath : "reused run: see .openlogs/codice/latest.txt",
      origin: codice.origin,
    },
    null,
    2,
  ),
);
