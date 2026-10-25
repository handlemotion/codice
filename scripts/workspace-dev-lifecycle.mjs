import { execFileSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import path from "node:path";

const LOCK_HOST = "127.0.0.1";

export function stableLocalLockPort(key, start = 40_000) {
  let hash = 0;
  for (const character of path.resolve(key)) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }
  return start + (hash % 10_000);
}

// A Conductor cloud workspace owns its whole VM but gets no CONDUCTOR_PORT range (only the
// desktop app allocates one). Without a range, four Workers probe portless for a free port at
// the same instant and two can be handed the same one; give the cloud workspace a fixed range.
const CLOUD_WORKSPACE_PORT_BASE = "4300";

export function cloudWorkspaceConductorPort(env) {
  if (env.CONDUCTOR_PORT?.trim()) return env.CONDUCTOR_PORT;
  return env.CONDUCTOR_WORKSPACE_ID?.trim() && env.CONDUCTOR_IS_LOCAL !== "1"
    ? CLOUD_WORKSPACE_PORT_BASE
    : undefined;
}

export function workspaceDevChildSpawnOptions(env) {
  const childEnv = { ...env };
  if (childEnv.CONDUCTOR_IS_LOCAL === "1") delete childEnv.NO_COLOR;
  return { env: childEnv, stdio: "inherit" };
}

export function workspaceDevLockPort(workspacePath, conductorPort) {
  if (conductorPort?.trim()) {
    const port = Number(conductorPort);
    if (Number.isSafeInteger(port) && port > 0 && port <= 65_535) return port;
    throw new Error("CONDUCTOR_PORT must be a valid local TCP port");
  }

  return stableLocalLockPort(workspacePath);
}

export async function waitForHttpOk(url, options = {}) {
  const fetchResponse = options.fetch ?? fetch;
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const retryMs = options.retryMs ?? 100;

  while (!options.signal?.aborted) {
    try {
      const response = await fetchResponse(url, { signal: options.signal });
      if (response.ok) return response;
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason ?? error;
    }
    await wait(retryMs);
  }
  throw options.signal.reason;
}

export function readOwner(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: LOCK_HOST, port });
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(1_000);
    socket.on("data", (chunk) => {
      response += chunk;
    });
    socket.on("end", () => {
      try {
        resolve(JSON.parse(response));
      } catch {
        resolve(null);
      }
    });
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

function defaultDevLockBusyMessage(detail) {
  return `This workspace already has an active dev run${detail}. Stop it first.`;
}

export async function acquireWorkspaceDevLock(owner, port, options = {}) {
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Workspace dev lock must use a valid local TCP port");
  }

  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const waitMs = options.waitMs ?? 0;
  const retryMs = options.retryMs ?? 50;
  const deadline = Date.now() + waitMs;
  const busyMessage = options.busyMessage ?? defaultDevLockBusyMessage;
  const readActiveOwner = options.readOwner ?? readOwner;
  let reportedBusy = false;

  while (true) {
    const server = createServer((socket) => socket.end(`${JSON.stringify(owner)}\n`));
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, LOCK_HOST, resolve);
      });
      return {
        port: server.address().port,
        close: () =>
          new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      };
    } catch (error) {
      server.close();
      if (error?.code !== "EADDRINUSE") throw error;
      const expired = Date.now() >= deadline;
      const activeOwner = !reportedBusy || expired ? await readActiveOwner(port) : null;
      if (!reportedBusy) {
        const handled = await options.onBusy?.(activeOwner);
        reportedBusy = handled !== false;
      }
      if (expired) {
        const detail = activeOwner?.pid ? ` (PID ${activeOwner.pid})` : "";
        throw new Error(busyMessage(detail));
      }
      await wait(retryMs);
    }
  }
}

export function parseProcessTable(output) {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      processGroupId: Number(match[3]),
      command: match[4],
    }));
}

export function parseProcessResourceTable(output) {
  return output
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      residentKilobytes: Number(match[3]),
      command: match[4],
    }));
}

function parseProcessIdentityTable(output) {
  return output
    .split("\n")
    .map((line) =>
      line.match(
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/u,
      ),
    )
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      processGroupId: Number(match[3]),
      startedAt: match[4].replace(/\s+/gu, " "),
      command: match[5],
    }));
}

export function workspaceProcessTreeIds(processes, rootPid) {
  if (!processes.some((process) => process.pid === rootPid)) return [];
  const childrenByParent = new Map();
  for (const process of processes) {
    const children = childrenByParent.get(process.ppid) ?? [];
    children.push(process.pid);
    childrenByParent.set(process.ppid, children);
  }

  const processIds = [];
  function visit(pid) {
    for (const childPid of childrenByParent.get(pid) ?? []) visit(childPid);
    processIds.push(pid);
  }
  visit(rootPid);
  return processIds;
}

export function workspaceProcessTreeResidentKilobytes(processes, rootPid) {
  const processIds = new Set(workspaceProcessTreeIds(processes, rootPid));
  return processes.reduce(
    (total, process) =>
      total + (processIds.has(process.pid) ? (process.residentKilobytes ?? 0) : 0),
    0,
  );
}

export function readWorkspaceProcessTreeResidentKilobytes(rootPid, options = {}) {
  const processTable =
    options.processTable ??
    execFileSync("ps", ["-axo", "pid=,ppid=,rss=,command="], { encoding: "utf8" });
  return workspaceProcessTreeResidentKilobytes(parseProcessResourceTable(processTable), rootPid);
}

export function nextSustainedMemorySampleCount(previousCount, residentKilobytes, limitKilobytes) {
  if (limitKilobytes === 0 || residentKilobytes <= limitKilobytes) return 0;
  return previousCount + 1;
}

export function signalProcessIds(processIds, signal, options = {}) {
  const kill = options.kill ?? process.kill;
  for (const pid of processIds) {
    try {
      kill(pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  return processIds;
}

export function signalWorkspaceProcessTree(rootPid, signal, options = {}) {
  const processTable =
    options.processTable ??
    execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  const processIds = workspaceProcessTreeIds(parseProcessTable(processTable), rootPid);
  return signalProcessIds(processIds, signal, options);
}

export async function terminateWorkspaceProcessTree(rootPid, options = {}) {
  const readProcessTable =
    options.readProcessTable ??
    (() =>
      execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,lstart=,command="], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
      }));
  const processes = parseProcessIdentityTable(options.processTable ?? readProcessTable());
  const processIds = workspaceProcessTreeIds(processes, rootPid);
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const graceMs = options.graceMs ?? 5_000;

  signalProcessIds(processIds, options.signal ?? "SIGTERM", options);
  if (graceMs > 0) await wait(graceMs);
  const currentProcesses = parseProcessIdentityTable(
    options.processTableAfterGrace ?? readProcessTable(),
  );
  const currentByPid = new Map(currentProcesses.map((process) => [process.pid, process]));
  const originalByPid = new Map(processes.map((process) => [process.pid, process]));
  const matchingProcessIds = processIds.filter((pid) => {
    const original = originalByPid.get(pid);
    const current = currentByPid.get(pid);
    return (
      original &&
      current &&
      original.processGroupId === current.processGroupId &&
      original.startedAt === current.startedAt &&
      original.command === current.command
    );
  });
  signalProcessIds(matchingProcessIds, "SIGKILL", options);
  return processIds;
}

function processAncestryGroupIds(processes, activePid) {
  const processesById = new Map(processes.map((process) => [process.pid, process]));
  const visitedProcessIds = new Set();
  const processGroupIds = new Set();
  let activeProcess = processesById.get(activePid);

  while (activeProcess && !visitedProcessIds.has(activeProcess.pid)) {
    visitedProcessIds.add(activeProcess.pid);
    processGroupIds.add(activeProcess.processGroupId);
    activeProcess = processesById.get(activeProcess.ppid);
  }

  return processGroupIds;
}

export function orphanedWorkspaceProcessGroups(processes, workspacePath, activePid = process.pid) {
  const workspacePrefix = `${path.resolve(workspacePath)}${path.sep}`;
  const activeProcessGroupIds = processAncestryGroupIds(processes, activePid);
  const orphanGroups = new Set(
    processes.filter((process) => process.ppid === 1).map((process) => process.processGroupId),
  );
  return [...orphanGroups].filter((processGroupId) => {
    if (activeProcessGroupIds.has(processGroupId)) return false;
    const members = processes.filter((process) => process.processGroupId === processGroupId);
    const belongsToWorkspace = members.some((process) => process.command.includes(workspacePrefix));
    const ownsGlobalPortlessProxy = members.some((process) =>
      /portless(?:\/dist\/cli\.js)? proxy start/u.test(process.command),
    );
    return belongsToWorkspace && !ownsGlobalPortlessProxy;
  });
}

export async function cleanupOrphanedWorkspaceProcessGroups(workspacePath, options = {}) {
  const processTable =
    options.processTable ??
    execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], { encoding: "utf8" });
  const processGroupIds = orphanedWorkspaceProcessGroups(
    parseProcessTable(processTable),
    workspacePath,
    options.activePid ?? process.pid,
  );
  const kill = options.kill ?? process.kill;
  const isAlive =
    options.isAlive ??
    ((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    });
  const wait =
    options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (const processGroupId of processGroupIds) {
    try {
      kill(-processGroupId, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }

  const groupIsAlive = (processGroupId) => isAlive(-processGroupId);
  for (let attempt = 0; attempt < 20 && processGroupIds.some(groupIsAlive); attempt += 1) {
    await wait(50);
  }
  for (const processGroupId of processGroupIds.filter(groupIsAlive)) {
    try {
      kill(-processGroupId, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  return processGroupIds;
}
