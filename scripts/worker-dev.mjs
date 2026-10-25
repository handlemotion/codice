#!/usr/bin/env node
/**
 * Runs Códice's `wrangler dev` under a supervisor, as `apps/api`'s `dev:app` script (Portless and
 * Doppler start it). Before each start it applies the local D1 migrations and, when the local D1
 * holds no records, seeds them with `ingest --local`. The supervisor recycles the runtime when it
 * stays above the memory limit, restarts it when it exits after serving, and restarts it on
 * `pnpm dev:restart` (the restart signal).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  applyLocalD1Migrations,
  describeD1MigrationResult,
  localD1MigrationTargets,
} from "./lib/local-d1-migrations.mjs";
import { describeCodiceSeedResult, seedLocalCodiceRecords } from "./lib/codice-local-records.mjs";
import {
  nextSustainedMemorySampleCount,
  readWorkspaceProcessTreeResidentKilobytes,
  terminateWorkspaceProcessTree,
} from "./workspace-dev-lifecycle.mjs";

export const APP = "api";
export const DEFAULT_MAX_RSS_MEGABYTES = 2_048;
export const MEMORY_SAMPLE_INTERVAL_MS = 10_000;
export const REQUIRED_HIGH_MEMORY_SAMPLES = 3;
export const TERMINATION_GRACE_MS = 5_000;
// A runtime that served at least this long and then exits on its own (crashed, or someone killed a
// hung `wrangler dev`) is started again. One that exits sooner failed to start, and that failure
// ends the dev run as before.
export const RESPAWN_MIN_UPTIME_MS = 30_000;
// `pnpm dev:restart` sends this signal to restart the runtime.
export const RESTART_SIGNAL = "SIGUSR2";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function configuredMaxRssMegabytes(value, defaultValue = DEFAULT_MAX_RSS_MEGABYTES) {
  const normalized = value?.trim();
  if (!normalized) return defaultValue;
  if (!/^\d+$/u.test(normalized)) {
    throw new Error("CODICE_DEV_MAX_RSS_MB must be a non-negative integer");
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("CODICE_DEV_MAX_RSS_MB must be a safe integer");
  }
  return parsed;
}

function requiredPort(env) {
  const value = env.PORT?.trim() ?? "";
  if (!/^\d+$/u.test(value)) throw new Error("PORT is required");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be a valid local TCP port");
  }
  return value;
}

export function workerDevSpec(env = process.env, root = repoRoot) {
  const port = requiredPort(env);
  const configured = env.WRANGLER_REGISTRY_PATH?.trim();
  return {
    app: "codice",
    command: "pnpm",
    args: ["exec", "wrangler", "dev", "--port", port, "--inspector-port", "0"],
    env: {
      ...env,
      WRANGLER_REGISTRY_PATH: configured || path.join(root, ".wrangler", "registry"),
    },
  };
}

export function shouldRespawnRuntime({ recycleRequested, stopping, uptimeMs = 0 }) {
  if (stopping) return false;
  return recycleRequested || uptimeMs >= RESPAWN_MIN_UPTIME_MS;
}

// Clears what is left of a runtime's process group. Killing `wrangler dev` alone can leave its
// `workerd` holding the port, and the next runtime would then fail to bind it.
function killProcessGroup(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function superviseRuntime(spec, options = {}) {
  const spawnChild = options.spawn ?? spawn;
  const readResidentKilobytes =
    options.readResidentKilobytes ?? readWorkspaceProcessTreeResidentKilobytes;
  const terminateProcessTree = options.terminateProcessTree ?? terminateWorkspaceProcessTree;
  const setIntervalFn = options.setInterval ?? setInterval;
  const clearIntervalFn = options.clearInterval ?? clearInterval;
  const signalTarget = options.signalTarget ?? process;
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const onSpawn = options.onSpawn ?? (() => {});
  const killGroup = options.killProcessGroup ?? killProcessGroup;
  const maxRssMegabytes = configuredMaxRssMegabytes(spec.env.CODICE_DEV_MAX_RSS_MB);
  const limitKilobytes = maxRssMegabytes * 1_024;

  let child;
  let stopping = false;
  let stopSignal = null;
  let recycleRequested = false;
  let termination = null;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    stopSignal = signal;
    if (child?.pid && !termination) {
      termination = terminateProcessTree(child.pid, {
        signal,
        graceMs: TERMINATION_GRACE_MS,
      });
    }
  };
  const restart = () => {
    if (stopping || recycleRequested || !child?.pid) return;
    recycleRequested = true;
    logger.warn(`${spec.app} local runtime restart requested; restarting only this runtime.`);
    termination = terminateProcessTree(child.pid, {
      signal: "SIGTERM",
      graceMs: TERMINATION_GRACE_MS,
    });
  };
  const signalHandlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [signal, () => stop(signal)]),
  );
  for (const [signal, handler] of signalHandlers) signalTarget.once(signal, handler);
  signalTarget.on(RESTART_SIGNAL, restart);

  try {
    while (!stopping) {
      recycleRequested = false;
      termination = null;
      let highMemorySamples = 0;
      let memoryReadWarningShown = false;
      child = null;
      if (options.beforeSpawn) {
        await options.beforeSpawn();
        if (stopping) break;
      }
      const startedAt = now();
      // Its own process group, so every process the runtime started can be cleared after it exits.
      child = spawnChild(spec.command, spec.args, {
        detached: true,
        env: spec.env,
        stdio: "inherit",
      });
      onSpawn(child);

      const monitor =
        maxRssMegabytes === 0
          ? null
          : setIntervalFn(() => {
              if (stopping || recycleRequested || !child?.pid) return;
              try {
                const residentKilobytes = readResidentKilobytes(child.pid);
                highMemorySamples = nextSustainedMemorySampleCount(
                  highMemorySamples,
                  residentKilobytes,
                  limitKilobytes,
                );
                memoryReadWarningShown = false;
                if (highMemorySamples < REQUIRED_HIGH_MEMORY_SAMPLES) return;

                recycleRequested = true;
                const residentMegabytes = Math.round(residentKilobytes / 1_024);
                logger.warn(
                  `${spec.app} local runtime stayed above ${maxRssMegabytes} MiB RSS ` +
                    `(${residentMegabytes} MiB); recycling only this runtime.`,
                );
                termination = terminateProcessTree(child.pid, {
                  signal: "SIGTERM",
                  graceMs: TERMINATION_GRACE_MS,
                });
              } catch (error) {
                if (!memoryReadWarningShown) {
                  memoryReadWarningShown = true;
                  logger.warn(
                    `${spec.app} local runtime RSS could not be sampled: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }
            }, MEMORY_SAMPLE_INTERVAL_MS);

      let exit;
      try {
        exit = await childExit(child);
      } finally {
        if (monitor) clearIntervalFn(monitor);
      }
      if (termination) await termination;
      killGroup(child.pid);

      const uptimeMs = now() - startedAt;
      if (shouldRespawnRuntime({ recycleRequested, stopping, uptimeMs })) {
        logger.warn(
          recycleRequested
            ? `${spec.app} local runtime recycled; restoring it on the same Portless route.`
            : `${spec.app} local runtime exited (${exit.signal ?? `code ${exit.code}`}) after ` +
                `${Math.round(uptimeMs / 1_000)}s; restarting it on the same Portless route.`,
        );
        continue;
      }
      if (stopping) return { code: null, signal: stopSignal };
      return exit;
    }
    return { code: null, signal: stopSignal };
  } finally {
    for (const [signal, handler] of signalHandlers) signalTarget.removeListener(signal, handler);
    signalTarget.removeListener(RESTART_SIGNAL, restart);
  }
}

export function runtimeStatePath(root = repoRoot) {
  return path.join(root, ".local", "dev-runtime", `${APP}.json`);
}

function fileDigest(filePath) {
  try {
    return createHash("sha256").update(readFileSync(filePath)).digest("hex");
  } catch {
    return null;
  }
}

// pnpm rewrites its installed-lockfile copy at the end of an install that changed `node_modules`.
// A `wrangler dev` that keeps running over replaced packages can rebuild into a runtime that never
// becomes ready, so a changed install restarts the runtime once the install has settled.
function watchInstalledDependencies(onChange) {
  const installedLockfile = path.join(repoRoot, "node_modules", ".pnpm", "lock.yaml");
  let digest = fileDigest(installedLockfile);
  let settleTimer = null;
  const listener = () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      const next = fileDigest(installedLockfile);
      if (next === null || next === digest) return;
      digest = next;
      onChange();
    }, 5_000);
  };
  watchFile(installedLockfile, { interval: 2_000 }, listener);
  return () => {
    clearTimeout(settleTimer);
    unwatchFile(installedLockfile, listener);
  };
}

async function prepareLocalDatabase() {
  const targets = localD1MigrationTargets(repoRoot).filter((target) => target.app === APP);
  if (targets.length === 0) return;
  const results = await applyLocalD1Migrations(targets);
  for (const result of results) {
    // A failed apply is reported, not fatal: the runtime still starts.
    (result.error ? console.error : console.log)(describeD1MigrationResult(result));
  }
  if (results.some((result) => result.error)) return;
  const seed = await seedLocalCodiceRecords();
  (seed.error ? console.error : console.log)(describeCodiceSeedResult(seed));
}

async function main() {
  const spec = workerDevSpec();
  const statePath = runtimeStatePath();
  mkdirSync(path.dirname(statePath), { recursive: true });
  const stopWatching = watchInstalledDependencies(() => {
    console.warn("codice: installed dependencies changed; restarting the local runtime.");
    process.kill(process.pid, RESTART_SIGNAL);
  });
  let result;
  try {
    result = await superviseRuntime(spec, {
      beforeSpawn: prepareLocalDatabase,
      onSpawn: (child) =>
        writeFileSync(
          statePath,
          `${JSON.stringify({ app: APP, supervisorPid: process.pid, runtimePid: child.pid, startedAt: new Date().toISOString() })}\n`,
        ),
    });
  } finally {
    stopWatching();
    rmSync(statePath, { force: true });
  }
  if (result.signal) {
    process.removeAllListeners(result.signal);
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.code ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
