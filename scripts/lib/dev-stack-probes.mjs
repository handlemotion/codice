import { execFileSync } from "node:child_process";

export function portlessOrigin(name) {
  try {
    return execFileSync("portless", ["get", name], {
      encoding: "utf8",
      env: {
        ...process.env,
        PORTLESS_LAN: "0",
        PORTLESS_TLD: "transitive.app",
      },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return `https://${name}.transitive.app`;
  }
}

// Códice's readiness on its worktree-aware Portless origin (linked worktrees prepend their branch
// slug).
export function codiceProbe() {
  const origin = portlessOrigin("codice.local");
  return { name: "codice", origin, url: `${origin}/ready`, ok: (status) => status === 200 };
}

export async function probe({ url, ok }) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return ok(response.status) ? null : `${response.status}`;
  } catch (error) {
    return error?.cause?.code ?? error?.name ?? "unreachable";
  }
}
