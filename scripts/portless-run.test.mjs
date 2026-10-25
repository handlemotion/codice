import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "vitest";

import { conductorAppPort, runPortlessApp } from "./portless-run.mjs";

test("runs Códice on its port of the Conductor allocation", async () => {
  const child = new EventEmitter();
  const result = runPortlessApp({
    env: { CONDUCTOR_PORT: "55030" },
    cwd: "/repo/apps/api",
    spawn: (command, args, options) => {
      assert.equal(command, "portless");
      assert.deepEqual(args, ["run", "--force", "--app-port", "55031"]);
      assert.equal(options.stdio, "inherit");
      assert.equal(options.detached, undefined);
      return child;
    },
  });
  child.emit("exit", 0, null);
  assert.deepEqual(await result, { code: 0, signal: null });
});

test("reports child startup failure immediately without waiting for a listening port", async () => {
  const child = new EventEmitter();
  const result = runPortlessApp({ spawn: () => child, env: {} });
  child.emit("exit", 1, null);
  assert.deepEqual(await result, { code: 1, signal: null });
});

test("reports spawn errors and signal exits", async () => {
  const child = new EventEmitter();
  const result = runPortlessApp({ spawn: () => child, env: {} });
  child.emit("error", new Error("spawn portless ENOENT"));
  await assert.rejects(result, /spawn portless ENOENT/u);

  const stoppedChild = new EventEmitter();
  const stopped = runPortlessApp({ spawn: () => stoppedChild, env: {} });
  stoppedChild.emit("exit", null, "SIGTERM");
  assert.deepEqual(await stopped, { code: null, signal: "SIGTERM" });
});

test("uses only the allocated Conductor port range", () => {
  assert.equal(conductorAppPort("/repo/apps/api", undefined), undefined);
  for (const port of ["0", "65527", "not-a-port", "1.5"]) {
    assert.throws(() => conductorAppPort("/repo/apps/api", port), /valid ten-port/u);
  }
  assert.throws(() => conductorAppPort("/repo/apps/unknown", "55030"), /No Conductor app port/u);
});

test("delegates port allocation to Portless outside Conductor", async () => {
  const child = new EventEmitter();
  const result = runPortlessApp({
    env: {},
    spawn: (_command, args) => {
      assert.deepEqual(args, ["run", "--force"]);
      return child;
    },
  });
  child.emit("exit", 0, null);
  await result;
});
