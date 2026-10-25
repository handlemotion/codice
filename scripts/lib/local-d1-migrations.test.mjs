import assert from "node:assert/strict";
import { test } from "vitest";

import {
  appliedMigrationNames,
  applyLocalD1Migrations,
  describeD1MigrationResult,
  localD1MigrationTargets,
} from "./local-d1-migrations.mjs";

test("finds every local D1 database that has a migrations directory", () => {
  assert.deepEqual(localD1MigrationTargets(), [{ app: "api", binding: "CODICE_DATABASE" }]);
});

test("reads the applied migration names from Wrangler output", () => {
  assert.deepEqual(appliedMigrationNames("✅ No migrations to apply!"), []);
  assert.deepEqual(
    appliedMigrationNames(
      [
        "Migrations to be applied:",
        "│ 0012_agent_file_page_count.sql │",
        "│ 0013_agent_file_retention.sql │",
        "│ 0012_agent_file_page_count.sql │ ✅ │",
        "│ 0013_agent_file_retention.sql │ ✅ │",
      ].join("\n"),
    ),
    ["0012_agent_file_page_count.sql", "0013_agent_file_retention.sql"],
  );
});

test("applies only with --local and reports failures without throwing", async () => {
  const calls = [];
  const results = await applyLocalD1Migrations(
    [
      { app: "agent", binding: "AGENT_STATE" },
      { app: "accounts", binding: "ACCOUNTS_DATABASE" },
    ],
    {
      root: "/repo",
      run: async (args, cwd) => {
        calls.push([args, cwd]);
        return cwd.endsWith("agent")
          ? { code: 0, output: "│ 0013_agent_file_retention.sql │ ✅ │" }
          : { code: 1, output: "boom" };
      },
    },
  );

  assert.deepEqual(calls[0], [
    ["d1", "migrations", "apply", "AGENT_STATE", "--local", "--config", "wrangler.jsonc"],
    "/repo/apps/agent",
  ]);
  assert.equal(
    describeD1MigrationResult(results[0]),
    "agent D1 AGENT_STATE: applied 0013_agent_file_retention.sql",
  );
  assert.match(describeD1MigrationResult(results[1]), /local migrations failed\nboom/u);
});
