import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/keys", label: "API keys" },
] as const;

export function DashboardShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <nav className="flex w-56 shrink-0 flex-col gap-1 border-r border-stone-200 p-4">
        <p className="px-2 pb-4 text-sm font-semibold">Códice</p>
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
        {/* `/?site` is the edge's switch to the marketing site for a signed-in visitor. */}
        <a className="mt-auto px-2 py-1.5 text-sm text-stone-500 hover:underline" href="/?site">
          Website
        </a>
      </nav>
      <main className="flex flex-1 flex-col gap-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}
