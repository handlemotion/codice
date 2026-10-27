import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { useAnimatedFavicon } from "../brand/mark";
import { THEME_SCRIPT, toggleTheme } from "../theme";
import "../styles.css";

const ORIGIN = "https://codice.io";
const TITLE = "Códice: las reglas fiscales y aduaneras de México, por HTTP y MCP";
const DESCRIPTION =
  "Busca las reglas del SAT tal como están escritas: CFDI 4.0, Pagos 2.0, catálogos, matriz de errores y la Resolución Miscelánea Fiscal, citadas textualmente con su fuente y vigencia.";
const IMAGE = `${ORIGIN}/_site/og.png`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { name: "application-name", content: "Códice" },
      { name: "theme-color", content: "#0a0a0b", media: "(prefers-color-scheme: dark)" },
      { name: "theme-color", content: "#e8e8e8", media: "(prefers-color-scheme: light)" },
      { name: "color-scheme", content: "dark light" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Códice" },
      { property: "og:locale", content: "es_MX" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: `${ORIGIN}/` },
      { property: "og:image", content: IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "Códice" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      { name: "twitter:image", content: IMAGE },
    ],
    links: [
      { rel: "canonical", href: `${ORIGIN}/` },
      { rel: "icon", type: "image/svg+xml", href: "/_site/favicon.svg" },
      { rel: "apple-touch-icon", href: "/_site/apple-touch-icon.png" },
      ...["PPRadioGrotesk-Regular", "PPRadioGrotesk-Bold"].map((file) => ({
        rel: "preload",
        href: `/_site/fonts/${file}.woff2`,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous" as const,
      })),
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Códice",
          url: `${ORIGIN}/`,
          description: DESCRIPTION,
          inLanguage: "es-MX",
          publisher: { "@type": "Organization", name: "Handlemotion" },
        }),
      },
    ],
  }),
  component: Outlet,
  shellComponent: RootDocument,
});

function AnimatedFavicon() {
  useAnimatedFavicon();
  return null;
}

// T switches between the light and dark theme, anywhere but in a text field.
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
      <body className="min-h-full bg-ink font-sans text-fg">
        {children}
        <AnimatedFavicon />
        <ThemeKey />
        <Scripts />
      </body>
    </html>
  );
}
