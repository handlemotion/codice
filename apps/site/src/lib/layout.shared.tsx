import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Mark } from "../brand/mark";

/** The docs' sidebar header: the brand, back to the home. The site's links live in SiteBar. */
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
  };
}
