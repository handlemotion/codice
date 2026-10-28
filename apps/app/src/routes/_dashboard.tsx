import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import { DashboardShell } from "../components/dashboard-shell";
import { keepDashboard, readDashboard } from "../dashboard-cache";

/**
 * Every signed-in page. Without a valid session it redirects to `/login`; the edge relies on
 * that answer to `/` to serve the site instead (`apps/edge/src/route.ts`, `isLoginRedirect`).
 */
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: async ({ matches }) => {
    const match = matches.find((candidate) => candidate.routeId === "/_dashboard");
    const dashboard = await readDashboard(!match || match.cause === "enter" || match.invalid);
    if (!dashboard) throw redirect({ to: "/login" });
    return { dashboard };
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { dashboard } = Route.useRouteContext();
  useEffect(() => keepDashboard(dashboard), [dashboard]);
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}
