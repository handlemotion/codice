#!/usr/bin/env node
/**
 * Restarts Códice's runtime inside the checkout's running dev run. It never starts a stack: with no
 * running dev run, use `pnpm dev:up`.
 *
 *   pnpm dev:restart
 *   pnpm dev:restart -- --timeout 300   # seconds to wait for readiness (default 180)
 *
 * The runtime is supervised by `scripts/worker-dev.mjs`, which records its pid in
 * `.local/dev-runtime/api.json` (a file left by a stopped run is ignored). This command sends that
 * supervisor the restart signal: it stops the runtime's process tree (SIGTERM, then SIGKILL after
 * five seconds, so a hung `wrangler dev` goes too), applies the pending local D1 migrations and
 * starts the runtime again on the same Portless route. The command then waits until it answers.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { codiceProbe, probe } from "./lib/dev-stack-probes.mjs";
import { reexecWithPortlessCa } from "./portless-ca.mjs";
import { RESTART_SIGNAL, runtimeStatePath } from "./worker-dev.mjs";

reexecWithPortlessCa(fileURLToPath(import.meta.url));

const timeoutIndex = process.argv.indexOf("--timeout");
const timeoutMs = Number(timeoutIndex >= 0 ? process.argv[timeoutIndex + 1] : 180) * 1000;
const workspacePath = process.cwd();
const codice = codiceProbe();

function readState() {
  try {
    return JSON.parse(readFileSync(runtimeStatePath(workspacePath), "utf8"));
  } catch {
    return null;
  }
}

function isSupervisor(pid) {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
    });
    return command.trim().endsWith("worker-dev.mjs");
  } catch {
    return false;
  }
}

const state = readState();
if (!state || !isSupervisor(state.supervisorPid)) {
  console.error("codice: no running dev runtime in this checkout; start it with pnpm dev:up");
  process.exit(1);
}
process.kill(state.supervisorPid, RESTART_SIGNAL);
console.log(`codice: restart requested (supervisor pid ${state.supervisorPid})`);

const deadline = Date.now() + timeoutMs;
let lastReport = 0;
while (true) {
  const current = readState();
  let failure;
  if (!current || !isSupervisor(current.supervisorPid)) {
    console.error("codice: its supervisor exited; see .openlogs/codice/latest.txt");
    process.exit(1);
  } else if (current.runtimePid === state.runtimePid) {
    failure = "stopping";
  } else {
    failure = await probe(codice);
  }
  if (failure === null) {
    console.log(`codice: restarted (runtime pid ${current.runtimePid})`);
    break;
  }
  if (Date.now() > deadline) {
    console.error(`codice not ready after ${timeoutMs / 1000}s: ${failure}`);
    process.exit(1);
  }
  if (Date.now() - lastReport > 15_000) {
    lastReport = Date.now();
    console.log(`waiting for codice=${failure}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
