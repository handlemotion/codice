import { availableParallelism } from "node:os";

import { defineConfig } from "vitest/config";

// Suites are import-bound (every isolated file re-imports its Worker graph), so
// wall time scales with workers. Vitest's own default is cpus - 1, which would
// halve the 2-CPU cloud workspaces: keep their two and let larger machines use
// the rest.
export const maxWorkers = Math.max(2, availableParallelism() - 1);

export const nodeTestOptions = {
  isolate: true,
  maxWorkers,
  pool: "threads" as const,
  testTimeout: 30_000,
};

export default defineConfig({
  root: process.cwd(),
  test: {
    ...nodeTestOptions,
    include: ["scripts/**/*.test.{ts,tsx,mts,mjs}", "src/**/*.test.{ts,tsx,mts,mjs}"],
  },
});
