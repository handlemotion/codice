import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  configuredMaxRssMegabytes,
  DEFAULT_MAX_RSS_MEGABYTES,
  RESPAWN_MIN_UPTIME_MS,
  runtimeStatePath,
  shouldRespawnRuntime,
  superviseRuntime,
  workerDevSpec,
} from "./worker-dev.mjs";

test("passes Conductor allocation through Turbo's strict environment", () => {
  const turboConfig = JSON.parse(readFileSync(new URL("../turbo.json", import.meta.url), "utf8"));
  assert.ok(turboConfig.globalPassThroughEnv.includes("CONDUCTOR_PORT"));
  assert.ok(turboConfig.globalPassThroughEnv.includes("CONDUCTOR_IS_LOCAL"));
});

test("runs Códice with plain wrangler dev on the Portless port", () => {
  const spec = workerDevSpec({ PORT: "5111" }, "/repo");

  assert.deepEqual(spec.args, [
    "exec",
    "wrangler",
    "dev",
    "--port",
    "5111",
    "--inspector-port",
    "0",
  ]);
  assert.equal(spec.env.WRANGLER_REGISTRY_PATH, "/repo/.wrangler/registry");
  assert.throws(() => workerDevSpec({}, "/repo"), /PORT is required/u);
  assert.throws(() => workerDevSpec({ PORT: "70000" }, "/repo"), /valid local TCP port/u);
});

test("keeps an explicit Wrangler registry path", () => {
  const spec = workerDevSpec({ PORT: "5111", WRANGLER_REGISTRY_PATH: "/shared/registry" }, "/repo");
  assert.equal(spec.env.WRANGLER_REGISTRY_PATH, "/shared/registry");
});

test("records the runtime under the checkout's .local", () => {
  assert.equal(runtimeStatePath("/repo"), "/repo/.local/dev-runtime/api.json");
});

test("uses a configurable memory guard and disables it only with zero", () => {
  assert.equal(configuredMaxRssMegabytes(undefined), DEFAULT_MAX_RSS_MEGABYTES);
  assert.equal(configuredMaxRssMegabytes("2048"), 2_048);
  assert.equal(configuredMaxRssMegabytes("0"), 0);
  // A freshly started runtime tree (wrangler, its esbuild watch service and workerd) can sit near
  // 1.7 GiB RSS; the guard must leave that steady state running.
  assert.ok(DEFAULT_MAX_RSS_MEGABYTES > 1_760);
  assert.throws(() => configuredMaxRssMegabytes("1.5"), /non-negative integer/u);
});

test("restarts a recycle or a runtime that had served, unless a user stop superseded it", () => {
  assert.equal(shouldRespawnRuntime({ recycleRequested: true, stopping: false }), true);
  assert.equal(shouldRespawnRuntime({ recycleRequested: true, stopping: true }), false);
  assert.equal(shouldRespawnRuntime({ recycleRequested: false, stopping: false }), false);
  assert.equal(
    shouldRespawnRuntime({
      recycleRequested: false,
      stopping: false,
      uptimeMs: RESPAWN_MIN_UPTIME_MS,
    }),
    true,
  );
  assert.equal(
    shouldRespawnRuntime({ recycleRequested: false, stopping: true, uptimeMs: 3_600_000 }),
    false,
  );
});

test("recycles only the runtime that sustains three high RSS samples", async () => {
  const signalTarget = new EventEmitter();
  const intervals = [];
  const children = [];
  const terminations = [];
  const spec = {
    app: "codice",
    command: "pnpm",
    args: ["exec", "wrangler", "dev"],
    env: { CODICE_DEV_MAX_RSS_MB: "1" },
  };

  const resultPromise = superviseRuntime(spec, {
    killProcessGroup: () => {},
    logger: { warn: () => {} },
    signalTarget,
    spawn: () => {
      const child = new EventEmitter();
      child.pid = 100 + children.length;
      children.push(child);
      if (children.length === 2) setImmediate(() => child.emit("exit", 0, null));
      return child;
    },
    readResidentKilobytes: () => 1_025,
    setInterval: (callback) => {
      intervals.push(callback);
      return callback;
    },
    clearInterval: () => {},
    terminateProcessTree: async (pid, options) => {
      terminations.push([pid, options.signal, options.graceMs]);
      setImmediate(() => children.at(-1).emit("exit", null, "SIGTERM"));
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  intervals[0]();
  intervals[0]();
  intervals[0]();

  assert.deepEqual(await resultPromise, { code: 0, signal: null });
  assert.equal(children.length, 2);
  assert.deepEqual(terminations, [[100, "SIGTERM", 5_000]]);
});

test("a user stop terminates the active runtime without respawning it", async () => {
  const signalTarget = new EventEmitter();
  const children = [];
  const spec = {
    app: "codice",
    command: "pnpm",
    args: ["exec", "wrangler", "dev"],
    env: { CODICE_DEV_MAX_RSS_MB: "0" },
  };

  const resultPromise = superviseRuntime(spec, {
    killProcessGroup: () => {},
    signalTarget,
    spawn: () => {
      const child = new EventEmitter();
      child.pid = 200;
      children.push(child);
      return child;
    },
    terminateProcessTree: async () => {
      setImmediate(() => children[0].emit("exit", null, "SIGTERM"));
    },
  });

  signalTarget.emit("SIGTERM");

  assert.deepEqual(await resultPromise, { code: null, signal: "SIGTERM" });
  assert.equal(children.length, 1);
});

test("a runtime that exits during startup keeps its original result and does not respawn", async () => {
  const signalTarget = new EventEmitter();
  let spawnCount = 0;
  const spec = {
    app: "codice",
    command: "pnpm",
    args: ["exec", "wrangler", "dev"],
    env: { CODICE_DEV_MAX_RSS_MB: "0" },
  };

  const result = await superviseRuntime(spec, {
    killProcessGroup: () => {},
    signalTarget,
    spawn: () => {
      spawnCount += 1;
      const child = new EventEmitter();
      child.pid = 300;
      setImmediate(() => child.emit("exit", 23, null));
      return child;
    },
  });

  assert.deepEqual(result, { code: 23, signal: null });
  assert.equal(spawnCount, 1);
});

test("a runtime that exits after serving is started again on its own", async () => {
  const signalTarget = new EventEmitter();
  const warnings = [];
  let clock = 0;
  let spawnCount = 0;
  const spec = {
    app: "codice",
    command: "pnpm",
    args: ["exec", "wrangler", "dev"],
    env: { CODICE_DEV_MAX_RSS_MB: "0" },
  };

  const clearedGroups = [];
  const result = await superviseRuntime(spec, {
    killProcessGroup: (pid) => clearedGroups.push(pid),
    signalTarget,
    logger: { warn: (message) => warnings.push(message) },
    now: () => clock,
    spawn: () => {
      spawnCount += 1;
      const child = new EventEmitter();
      child.pid = 400 + spawnCount;
      setImmediate(() => {
        // The first runtime is killed after serving for a minute; the second fails at startup.
        clock += spawnCount === 1 ? 60_000 : 1_000;
        child.emit("exit", spawnCount === 1 ? null : 1, spawnCount === 1 ? "SIGKILL" : null);
      });
      return child;
    },
  });

  assert.equal(spawnCount, 2);
  assert.deepEqual(result, { code: 1, signal: null });
  // Each runtime's leftovers (a `workerd` still holding the port) are cleared before the next.
  assert.deepEqual(clearedGroups, [401, 402]);
  assert.match(warnings[0], /codice local runtime exited \(SIGKILL\) after 60s; restarting/u);
});

test("the restart signal restarts only the runtime and reruns the pre-start step", async () => {
  const signalTarget = new EventEmitter();
  const children = [];
  const terminations = [];
  const events = [];
  const spec = {
    app: "codice",
    command: "pnpm",
    args: ["exec", "wrangler", "dev"],
    env: { CODICE_DEV_MAX_RSS_MB: "0" },
  };

  const resultPromise = superviseRuntime(spec, {
    killProcessGroup: () => {},
    signalTarget,
    logger: { warn: () => {} },
    beforeSpawn: async () => events.push("migrate"),
    onSpawn: (child) => events.push(`spawn ${child.pid}`),
    spawn: () => {
      const child = new EventEmitter();
      child.pid = 500 + children.length;
      children.push(child);
      return child;
    },
    terminateProcessTree: async (pid, options) => {
      terminations.push([pid, options.signal]);
      setImmediate(() => children.at(-1).emit("exit", null, options.signal));
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  signalTarget.emit("SIGUSR2");
  while (children.length < 2) await new Promise((resolve) => setImmediate(resolve));
  signalTarget.emit("SIGTERM");

  assert.deepEqual(await resultPromise, { code: null, signal: "SIGTERM" });
  assert.deepEqual(events, ["migrate", "spawn 500", "migrate", "spawn 501"]);
  assert.deepEqual(terminations, [
    [500, "SIGTERM"],
    [501, "SIGTERM"],
  ]);
  assert.equal(signalTarget.listenerCount("SIGUSR2"), 0);
});
