import { createFileRoute } from "@tanstack/react-router";

import { DashboardShell } from "../components/dashboard-shell";

export const Route = createFileRoute("/keys")({ component: Keys });

function Keys() {
  return (
    <DashboardShell title="API keys">
      <p className="text-stone-600">
        Create, name and revoke the keys that authenticate calls to <code>/v1</code> and{" "}
        <code>/mcp</code>.
      </p>
    </DashboardShell>
  );
}
