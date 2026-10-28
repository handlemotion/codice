import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { useAnimatedFavicon } from "../brand/mark";
import { TooltipProvider } from "../components/ui/tooltip";
import { THEME_SCRIPT, toggleTheme } from "../theme";
import "../styles.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Códice" },
      { name: "theme-color", content: "#0a0a0b" },
      { name: "color-scheme", content: "dark light" },
      { name: "robots", content: "noindex" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      ...["PPRadioGrotesk-Regular", "PPRadioGrotesk-Bold"].map((file) => ({
        rel: "preload",
        href: `/fonts/${file}.woff2`,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      })),
    ],
  }),
  component: Outlet,
  shellComponent: RootDocument,
});

function AnimatedFavicon() {
  useAnimatedFavicon();
  return null;
}

// T switches between the light and dark theme, anywhere but in a text field, as on the site.
function ThemeKey() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "t" && event.key !== "T") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { target } = event;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable]")) return;
      toggleTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html className="h-full antialiased" lang="es-MX" suppressHydrationWarning>
      {/* oxlint-disable-next-line next/no-head-element -- TanStack Start document shell. */}
      <head>
        {/* Before any paint, so a remembered theme never flashes the other one. */}
        {/* oxlint-disable-next-line react/no-danger -- A constant, inline script of our own. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="min-h-full bg-ink font-sans text-[14px] leading-[1.7] text-fg">
        <TooltipProvider>{children}</TooltipProvider>
        <AnimatedFavicon />
        <ThemeKey />
        <Scripts />
      </body>
    </html>
  );
}
