import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Mark } from "../brand/mark";

/** The docs' bar: the brand back to the home, and the site's own links. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2.5 font-bold">
          <Mark className="size-4" strokeWidth={1.5} />
          Códice
        </span>
      ),
      url: "/",
    },
    themeSwitch: { enabled: false },
    links: [
      { text: "Producto", url: "/" },
      { text: "Documentación", url: "/docs", active: "nested-url" },
      { text: "API", url: "/docs/api" },
      { text: "Precios", url: "/#precios" },
    ],
  };
}
