import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { getDashboard } from "../server/functions";

/**
 * Every signed-in page. Without a valid session it redirects to `/login`; the edge relies on
 * that answer to `/` to serve the site instead (`apps/edge/src/route.ts`, `isLoginRedirect`).
 */
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: async () => {
    const dashboard = await getDashboard();
    if (!dashboard) throw redirect({ to: "/login" });
    return { dashboard };
  },
  component: Outlet,
});
