import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Códice" },
    ],
  }),
  component: Outlet,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html className="h-full antialiased" lang="es">
      {/* oxlint-disable-next-line next/no-head-element -- TanStack Start document shell. */}
      <head>
        <HeadContent />
      </head>
      <body className="min-h-full bg-stone-50 font-sans text-stone-900">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
