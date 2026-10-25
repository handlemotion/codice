import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Node reads NODE_EXTRA_CA_CERTS only at process startup, and neither the in-process CA list nor an
// env mutation reaches undici fetch or already running children. A dev script calls this first: it
// re-executes the script once with the portless CA in the environment, so readiness probes and
// spawned workers all trust it.
export function reexecWithPortlessCa(scriptPath) {
  const portlessCaPath = join(
    process.env.PORTLESS_STATE_DIR?.trim() || join(homedir(), ".portless"),
    "ca.pem",
  );
  if (process.env.NODE_EXTRA_CA_CERTS || !existsSync(portlessCaPath)) return;
  const reexec = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NODE_EXTRA_CA_CERTS: portlessCaPath },
  });
  process.exit(reexec.status ?? 1);
}
