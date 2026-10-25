import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { changedFiles } from "./ci-changed-files.mjs";

// Failure cases: a branch behind main includes foreign changes; renames hide a
// deleted migration; whitespace corrupts paths; missing refs silently skip CI.
test("real Git history selects PR changes and complete push changes", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ci-diff-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    git("init", "-b", "main");
    git("config", "user.email", "ci@example.invalid");
    git("config", "user.name", "CI test");
    writeFileSync(join(cwd, "migration.sql"), "select 1;\n");
    git("add", ".");
    git("commit", "-m", "base");
    const original = git("rev-parse", "HEAD");
    git("checkout", "-b", "ui");
    writeFileSync(join(cwd, "button with space.tsx"), "export const size = 1;\n");
    git("mv", "migration.sql", "renamed.sql");
    git("add", ".");
    git("commit", "-m", "UI and rename");
    const head = git("rev-parse", "HEAD");
    git("checkout", "main");
    writeFileSync(join(cwd, "backend.ts"), "export const version = 2;\n");
    git("add", ".");
    git("commit", "-m", "unrelated main change");
    const base = git("rev-parse", "HEAD");
    const expected = ["button with space.tsx", "migration.sql", "renamed.sql"];
    assert.deepEqual(changedFiles("pull_request", base, head, cwd), expected);
    assert.deepEqual(changedFiles("merge_group", original, head, cwd), expected);
    assert.deepEqual(changedFiles("push", original, base, cwd), ["backend.ts"]);
    assert.deepEqual(changedFiles("push", base, head, cwd), ["backend.ts", ...expected]);
    assert.throws(() => changedFiles("pull_request", "", head, cwd));
    assert.throws(() => changedFiles("push", "missing-ref", head, cwd));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
