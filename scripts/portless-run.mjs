#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { workspaceDevChildSpawnOptions } from "./workspace-dev-lifecycle.mjs";

// Each app's port inside a Conductor workspace's ten-port allocation.
const CONDUCTOR_APP_OFFSETS = {
  api: 1,
};

export function conductorAppPort(cwd, conductorPort) {
  if (!conductorPort?.trim()) return undefined;
  const base = Number(conductorPort);
  const offset = CONDUCTOR_APP_OFFSETS[path.basename(cwd)];
  if (!Number.isSafeInteger(base) || base < 1 || base + 9 > 65_535) {
    throw new Error("CONDUCTOR_PORT must start a valid ten-port allocation");
  }
  if (!Number.isInteger(offset)) {
    throw new Error(`No Conductor app port assigned for ${path.basename(cwd)}`);
  }
  return base + offset;
}

function childExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

export async function runPortlessApp(options = {}) {
  const spawnChild = options.spawn ?? spawn;
  const env = options.env ?? process.env;
  const port = conductorAppPort(options.cwd ?? process.cwd(), env.CONDUCTOR_PORT);
  const args = ["run", "--force"];
  if (port !== undefined) args.push("--app-port", String(port));
  const child = spawnChild("portless", args, workspaceDevChildSpawnOptions(env));
  return childExit(child);
}

async function main() {
  const result = await runPortlessApp();
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
