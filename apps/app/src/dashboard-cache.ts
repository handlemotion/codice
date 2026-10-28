import { getDashboard } from "./server/functions";
import type { Dashboard } from "./server/teams";

/**
 * The user and their teams, kept in the browser between the dashboard's pages: the `_dashboard`
 * route's `beforeLoad` runs on every move and every hover preload, and each page's loader waits
 * for it. They are read again on entering the dashboard (a sign-in, an accepted invitation),
 * after `router.invalidate()` (every change a page makes) and once `KEEP_MS` old; the server
 * reads them on every request. Its own module: the router splits a route's component from its
 * `beforeLoad`, and both need the same copy.
 */
const KEEP_MS = 60_000;
let kept: { at: number; dashboard: Promise<Dashboard | null> } | null = null;

export function readDashboard(fresh: boolean) {
  if (typeof window === "undefined") return getDashboard();
  if (fresh || !kept || Date.now() - kept.at > KEEP_MS) {
    const dashboard = getDashboard();
    kept = { at: Date.now(), dashboard };
    dashboard.then(
      (value) => {
        if (!value && kept?.dashboard === dashboard) kept = null;
      },
      () => {
        if (kept?.dashboard === dashboard) kept = null;
      },
    );
  }
  return kept.dashboard;
}

/** A page rendered on the server hands its dashboard to the next move in the browser. */
export function keepDashboard(dashboard: Dashboard) {
  kept ??= { at: Date.now(), dashboard: Promise.resolve(dashboard) };
}
