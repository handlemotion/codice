import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import {
  acquireWorkspaceDevLock,
  cloudWorkspaceConductorPort,
  cleanupOrphanedWorkspaceProcessGroups,
  nextSustainedMemorySampleCount,
  orphanedWorkspaceProcessGroups,
  parseProcessResourceTable,
  parseProcessTable,
  readWorkspaceProcessTreeResidentKilobytes,
  signalWorkspaceProcessTree,
  stableLocalLockPort,
  terminateWorkspaceProcessTree,
  waitForHttpOk,
  workspaceDevChildSpawnOptions,
  workspaceDevLockPort,
  workspaceProcessTreeIds,
  workspaceProcessTreeResidentKilobytes,
} from "./workspace-dev-lifecycle.mjs";

const conductorDevApps = ["api"];

test("Conductor app dev scripts can reclaim stale Portless routes", () => {
  const wrapper = readFileSync(new URL("./portless-run.mjs", import.meta.url), "utf8");
  assert.match(wrapper, /"--force"/u);
  for (const app of conductorDevApps) {
    const manifest = JSON.parse(
      readFileSync(new URL(`../apps/${app}/package.json`, import.meta.url)),
    );
    assert.match(manifest.scripts.dev, /\bportless-run\.mjs\b/u, app);
  }
});

test("keeps the dev child attached to the foreground terminal", () => {
  const env = { PATH: "/bin" };
  const options = workspaceDevChildSpawnOptions(env);
  assert.deepEqual(options, { env, stdio: "inherit" });
  assert.equal("detached" in options, false);
});

test("enables CLI colors in the local Conductor Dev pane", () => {
  const env = { CONDUCTOR_IS_LOCAL: "1", NO_COLOR: "1", PATH: "/bin" };
  const options = workspaceDevChildSpawnOptions(env);
  assert.deepEqual(options.env, { CONDUCTOR_IS_LOCAL: "1", PATH: "/bin" });
  assert.equal(env.NO_COLOR, "1");
});

test("uses Conductor's allocated port or a stable workspace fallback", () => {
  assert.equal(workspaceDevLockPort("/repo/worktree", "55010"), 55_010);
  assert.equal(
    workspaceDevLockPort("/repo/worktree", undefined),
    workspaceDevLockPort("/repo/worktree", undefined),
  );
  assert.notEqual(
    workspaceDevLockPort("/repo/worktree", undefined),
    workspaceDevLockPort("/repo/other", undefined),
  );
  assert.equal(stableLocalLockPort("/repo", 30_000), stableLocalLockPort("/repo", 30_000));
  assert.notEqual(stableLocalLockPort("/repo", 30_000), stableLocalLockPort("/other", 30_000));
});

test("waits for an actual successful HTTP response", async () => {
  let attempts = 0;
  const response = await waitForHttpOk("http://127.0.0.1/login", {
    fetch: async () => ({ ok: ++attempts === 3 }),
    wait: async () => {},
  });
  assert.equal(response.ok, true);
  assert.equal(attempts, 3);
});

test("allows only one dev owner on a workspace port", async () => {
  const first = await acquireWorkspaceDevLock({ pid: 123 }, 0);
  try {
    await assert.rejects(
      acquireWorkspaceDevLock({ pid: 456 }, first.port),
      /active dev run \(PID 123\)/u,
    );
  } finally {
    await first.close();
  }
});

test("waits for a busy allocation lock until it is released", async () => {
  const owner = { kind: "test", pid: 1, workspace: "first" };
  const first = await acquireWorkspaceDevLock(owner, 0);
  let released = false;
  let reportedOwner;
  try {
    const secondPromise = acquireWorkspaceDevLock({ pid: 2 }, first.port, {
      onBusy: (activeOwner) => {
        reportedOwner = activeOwner;
      },
      retryMs: 10,
      waitMs: 1_000,
      wait: async () => {
        if (!released) {
          released = true;
          await first.close();
        }
      },
    });
    const second = await secondPromise;
    assert.deepEqual(reportedOwner, owner);
    await second.close();
  } catch (error) {
    if (!released) await first.close();
    throw error;
  }
});

test("retries when a lock owner disappears during ownership lookup", async () => {
  const first = await acquireWorkspaceDevLock({ pid: 1 }, 0);
  let released = false;
  let ownerReads = 0;
  try {
    const second = await acquireWorkspaceDevLock({ pid: 2 }, first.port, {
      onBusy: (activeOwner) => {
        assert.equal(activeOwner, null);
        return false;
      },
      readOwner: async () => {
        ownerReads += 1;
        return null;
      },
      retryMs: 10,
      waitMs: 1_000,
      wait: async () => {
        if (!released) {
          released = true;
          await first.close();
        }
      },
    });
    assert.equal(ownerReads, 1);
    await second.close();
  } catch (error) {
    if (!released) await first.close();
    throw error;
  }
});

test("selects stale workspace groups but preserves active and global proxy groups", () => {
  const workspace = "/repo/worktree";
  const processes = parseProcessTable(`
  101 1 90 /repo/worktree/node_modules/.pnpm/workerd/bin/workerd serve
  102 55 90 /repo/worktree/node_modules/.pnpm/workerd/bin/workerd serve
  103 1 91 /repo/other/node_modules/.pnpm/workerd/bin/workerd serve
  104 1 92 /usr/bin/something
  105 1 93 /repo/worktree/node_modules/.pnpm/portless/dist/cli.js proxy start
  106 44 94 /repo/worktree/node_modules/.pnpm/workerd/bin/workerd serve
`);
  assert.deepEqual(orphanedWorkspaceProcessGroups(processes, workspace), [90]);
});

test("signals a workspace process tree from leaves to root", () => {
  const processTable = `
  101 1 90 pnpm run dev:apps
  102 101 90 turbo run dev
  103 102 90 openlogs transitive
  104 1 91 unrelated
`;
  const processes = parseProcessTable(processTable);
  assert.deepEqual(workspaceProcessTreeIds(processes, 101), [103, 102, 101]);
  assert.deepEqual(workspaceProcessTreeIds(processes, 999), []);

  const calls = [];
  assert.deepEqual(
    signalWorkspaceProcessTree(101, "SIGHUP", {
      processTable,
      kill: (pid, signal) => calls.push([pid, signal]),
    }),
    [103, 102, 101],
  );
  assert.deepEqual(calls, [
    [103, "SIGHUP"],
    [102, "SIGHUP"],
    [101, "SIGHUP"],
  ]);
});

test("totals RSS for only the selected runtime subtree", () => {
  const processTable = `
  101 1 100 pnpm exec wrangler dev
  102 101 200 node wrangler
  103 102 300 workerd serve
  104 1 999 unrelated
`;
  const processes = parseProcessResourceTable(processTable);
  assert.equal(workspaceProcessTreeResidentKilobytes(processes, 101), 600);
  assert.equal(readWorkspaceProcessTreeResidentKilobytes(101, { processTable }), 600);
});

test("requires consecutive RSS samples above the configured limit", () => {
  let count = 0;
  count = nextSustainedMemorySampleCount(count, 1_600, 1_500);
  count = nextSustainedMemorySampleCount(count, 1_700, 1_500);
  assert.equal(count, 2);
  count = nextSustainedMemorySampleCount(count, 1_400, 1_500);
  assert.equal(count, 0);
  assert.equal(nextSustainedMemorySampleCount(2, 1_800, 1_500), 3);
  assert.equal(nextSustainedMemorySampleCount(2, 9_999, 0), 0);
});

test("terminates a runtime tree gracefully before forcing only matching remaining processes", async () => {
  const calls = [];
  const waits = [];
  const processTable = `
  101 1 90 Sun Aug 23 19:00:00 2026 pnpm exec wrangler dev
  102 101 90 Sun Aug 23 19:00:01 2026 node wrangler
  103 102 90 Sun Aug 23 19:00:02 2026 workerd serve
`;
  const processTableAfterGrace = `
  102 1 90 Sun Aug 23 19:00:01 2026 node wrangler
  103 1 91 Sun Aug 23 19:00:04 2026 unrelated reused pid
`;
  const processIds = await terminateWorkspaceProcessTree(101, {
    processTable,
    processTableAfterGrace,
    graceMs: 5_000,
    kill: (pid, signal) => calls.push([pid, signal]),
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.deepEqual(processIds, [103, 102, 101]);
  assert.deepEqual(waits, [5_000]);
  assert.deepEqual(calls, [
    [103, "SIGTERM"],
    [102, "SIGTERM"],
    [101, "SIGTERM"],
    [102, "SIGKILL"],
  ]);
});

test("cleanup signals each selected orphaned process group once", async () => {
  const calls = [];
  const groups = await cleanupOrphanedWorkspaceProcessGroups("/repo/worktree", {
    processTable: "101 1 90 /repo/worktree/node_modules/.pnpm/workerd/bin/workerd serve\n",
    kill: (pid, signal) => calls.push([pid, signal]),
    isAlive: () => false,
    wait: () => Promise.resolve(),
  });
  assert.deepEqual(groups, [90]);
  assert.deepEqual(calls, [[-90, "SIGTERM"]]);
});

test("cleanup never signals the active process or ancestor process groups", async () => {
  const calls = [];
  const groups = await cleanupOrphanedWorkspaceProcessGroups("/repo/worktree", {
    activePid: 102,
    processTable: `
  100 1 90 /Applications/Conductor.app/Contents/MacOS/conductor
  101 1 90 /repo/worktree/node_modules/.pnpm/workerd/bin/workerd serve
  102 100 102 node /repo/worktree/scripts/dev.mjs
  200 1 200 /repo/worktree/node_modules/.pnpm/workerd/bin/workerd serve
`,
    kill: (pid, signal) => calls.push([pid, signal]),
    isAlive: () => false,
    wait: () => Promise.resolve(),
  });

  assert.deepEqual(groups, [200]);
  assert.deepEqual(calls, [[-200, "SIGTERM"]]);
});

test("a cloud workspace gets a fixed Conductor port range; desktop and plain checkouts do not", () => {
  assert.equal(
    cloudWorkspaceConductorPort({ CONDUCTOR_WORKSPACE_ID: "ws-1", CONDUCTOR_IS_LOCAL: "0" }),
    "4300",
  );
  assert.equal(
    cloudWorkspaceConductorPort({ CONDUCTOR_WORKSPACE_ID: "ws-1", CONDUCTOR_IS_LOCAL: "1" }),
    undefined,
  );
  assert.equal(cloudWorkspaceConductorPort({}), undefined);
  assert.equal(
    cloudWorkspaceConductorPort({ CONDUCTOR_WORKSPACE_ID: "ws-1", CONDUCTOR_PORT: "55030" }),
    "55030",
  );
});
