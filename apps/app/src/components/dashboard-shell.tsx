import { Link, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { authClient } from "../auth-client";
import { setActiveTeam } from "../server/functions";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/keys", label: "API keys" },
] as const;

const dashboardRoute = getRouteApi("/_dashboard");

export function DashboardShell({ title, children }: { title: string; children: ReactNode }) {
  const { dashboard } = dashboardRoute.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();

  async function switchTeam(organizationId: string) {
    await setActiveTeam({ data: organizationId });
    await router.invalidate();
  }

  async function signOut() {
    await authClient.signOut();
    await navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-stone-200 p-4">
        <p className="px-2 pb-2 text-sm font-semibold">Códice</p>
        <label className="flex flex-col gap-1 px-2 pb-4 text-xs text-stone-500">
          Team
          <select
            className="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900"
            onChange={(event) => void switchTeam(event.target.value)}
            value={dashboard.team?.id ?? ""}
          >
            {dashboard.teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        {NAV.map((item) => (
          <Link
            activeOptions={{ exact: true }}
            activeProps={{ className: "bg-stone-200" }}
            className="rounded-md px-2 py-1.5 text-sm hover:bg-stone-100"
            key={item.to}
            to={item.to}
          >
            {item.label}
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-1">
          {/* `/?site` is the edge's switch to the marketing site for a signed-in visitor. */}
          <a className="px-2 py-1.5 text-sm text-stone-500 hover:underline" href="/?site">
            Website
          </a>
          <p className="truncate px-2 pt-2 text-xs text-stone-500">{dashboard.user.email}</p>
          <button
            className="px-2 py-1.5 text-left text-sm text-stone-500 hover:underline"
            onClick={() => void signOut()}
            type="button"
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="flex flex-1 flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}
