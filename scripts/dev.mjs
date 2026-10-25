#!/usr/bin/env node
/**
 * `pnpm dev`: starts the portless HTTPS proxy, then Códice (`@codice/api` `dev`) on
 * `https://codice.local.transitive.app`, and holds this checkout's dev lock so a second run never
 * starts beside it. Stop it with Ctrl-C.
 */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { reexecWithPortlessCa } from "./portless-ca.mjs";
import {
  acquireWorkspaceDevLock,
  cleanupOrphanedWorkspaceProcessGroups,
  cloudWorkspaceConductorPort,
  signalWorkspaceProcessTree,
  workspaceDevChildSpawnOptions,
  workspaceDevLockPort,
} from "./workspace-dev-lifecycle.mjs";

reexecWithPortlessCa(fileURLToPath(import.meta.url));

const workspacePath = process.cwd();
// Turbo passes CONDUCTOR_PORT through to the app, so fixing it here gives the Worker its
// deterministic port in a cloud workspace exactly as the desktop allocation does.
const conductorPort = cloudWorkspaceConductorPort(process.env);
if (conductorPort) process.env.CONDUCTOR_PORT = conductorPort;
const lockPort = workspaceDevLockPort(workspacePath, process.env.CONDUCTOR_PORT);
const lock = await acquireWorkspaceDevLock({ pid: process.pid, workspacePath }, lockPort);
const cleanedGroups = await cleanupOrphanedWorkspaceProcessGroups(workspacePath);
if (cleanedGroups.length > 0) {
  console.log(`Stopped ${cleanedGroups.length} orphaned workspace dev process group(s).`);
}

execFileSync("pnpm", ["dev:proxy:start"], { stdio: "inherit" });

const child = spawn(
  "pnpm",
  ["exec", "turbo", "run", "dev", "--ui=stream", "--filter=@codice/api"],
  workspaceDevChildSpawnOptions(process.env),
);
const exit = new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

let stopping = false;
let receivedSignal = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    receivedSignal = signal;
    if (stopping) return;
    stopping = true;
    signalWorkspaceProcessTree(child.pid, signal === "SIGHUP" ? "SIGKILL" : signal);
    if (signal !== "SIGHUP") {
      setTimeout(() => signalWorkspaceProcessTree(child.pid, "SIGKILL"), 5_000).unref();
    }
  });
}

let result;
try {
  result = await exit;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  result = { code: 1, signal: null };
} finally {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await cleanupOrphanedWorkspaceProcessGroups(workspacePath);
  await lock.close();
}

const exitSignal = receivedSignal ?? result.signal;
if (exitSignal) {
  process.removeAllListeners(exitSignal);
  process.kill(process.pid, exitSignal);
} else {
  process.exit(result.code ?? 1);
}
