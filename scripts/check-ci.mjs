import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { changedFiles } from "./ci-changed-files.mjs";

const run = (args) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const event = process.env.GITHUB_EVENT_NAME;
if (event === "schedule" || event === "workflow_dispatch") {
  run(["check"]);
} else {
  const files = changedFiles(event, process.env.TURBO_SCM_BASE, process.env.TURBO_SCM_HEAD);
  const globalInputs = new Set([
    ".oxfmtrc.json",
    ".oxlintrc.json",
    ".editorconfig",
    ".gitignore",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]);
  if (files.some((file) => globalInputs.has(file))) {
    run(["exec", "oxfmt", "--check", "."]);
    run(["exec", "oxlint", "."]);
  } else {
    const existing = files.filter((file) => existsSync(file));
    const formatted = existing.filter((file) =>
      /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|css|scss|html|mdx?|graphql|gql|vue)$/.test(file),
    );
    const linted = existing.filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    for (const [args, paths] of [
      [["exec", "oxfmt", "--check"], formatted],
      [["exec", "oxlint"], linted],
    ]) {
      for (let index = 0; index < paths.length; index += 100) {
        const command = [...args, "--", ...paths.slice(index, index + 100)];
        const result = spawnSync("pnpm", command, { encoding: "utf8" });
        if (result.error) throw result.error;
        process.stdout.write(result.stdout ?? "");
        process.stderr.write(result.stderr ?? "");
        if (result.status !== 0) {
          const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
          // A diff that only touches generated files excluded by
          // ignorePatterns (e.g. *.openapi.json snapshots) leaves the tool
          // with nothing to check — that is a skip, not a failure. oxfmt and
          // oxlint word that condition differently.
          if (
            output.includes("Expected at least one target file") ||
            output.includes("No files found to lint")
          ) {
            continue;
          }
          process.exit(result.status ?? 1);
        }
      }
    }
  }
}
