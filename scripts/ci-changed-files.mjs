import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Match GitHub: PRs compare to the merge base; pushes compare the two tips.
// Disable rename detection so deleting/moving a guarded input selects both paths.
export function changedFiles(event, base, head, cwd = process.cwd()) {
  if (!["pull_request", "merge_group", "push"].includes(event) || !base || !head) {
    throw new Error("CI changed files requires a PR, merge group, or push and both Git refs");
  }
  const refs = event === "pull_request" ? [`${base}...${head}`] : [base, head];
  return execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", ...refs, "--"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(
    JSON.stringify(
      changedFiles(
        process.env.GITHUB_EVENT_NAME,
        process.env.TURBO_SCM_BASE,
        process.env.TURBO_SCM_HEAD,
      ),
    ),
  );
}
