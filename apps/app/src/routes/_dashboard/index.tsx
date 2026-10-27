import { createFileRoute } from "@tanstack/react-router";

import { DashboardShell } from "../../components/dashboard-shell";

export const Route = createFileRoute("/_dashboard/")({ component: Overview });

function Overview() {
  return (
    <DashboardShell title="Overview">
      <p className="text-stone-600">
        Request volume, latency and errors per API key will show here.
      </p>
    </DashboardShell>
  );
}
