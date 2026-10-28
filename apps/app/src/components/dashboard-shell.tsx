import {
  IconBook,
  IconChart4,
  IconContrast,
  IconKey2,
  IconGroup1,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { Link, getRouteApi, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ComponentType, type ReactNode } from "react";

import { Mark } from "../brand/mark";
import { toggleTheme } from "../theme";
import { Key, PersonAvatar } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Destination = { label: string; key: string } & (
  | {
      to: "/" | "/keys" | "/team" | "/account";
      icon?: ComponentType<{ size?: number }>;
    }
  | { href: string; icon: ComponentType<{ size?: number }> }
);

// The rail's places, in order, each on its number key. The team's settings come before the
// user's own account, which is the avatar, last.
const USAGE: Destination = { to: "/", label: "Uso", key: "1", icon: IconChart4 };
const KEYS: Destination = { to: "/keys", label: "Claves", key: "2", icon: IconKey2 };
const DOCS: Destination = { href: "/docs", label: "Documentación", key: "3", icon: IconBook };
const TEAM: Destination = { to: "/team", label: "Equipo", key: "4", icon: IconGroup1 };
const ACCOUNT: Destination = { to: "/account", label: "Cuenta", key: "5" };
const PLACES = [USAGE, KEYS, DOCS, TEAM, ACCOUNT];

const dashboardRoute = getRouteApi("/_dashboard");

// A rail button: a 32px square that, for the current page, takes the island's look.
const ITEM =
  "grid size-8 place-items-center rounded-[4px] border outline-none focus-visible:border-fg";
const IDLE = "border-transparent text-muted hover:text-fg";
const CURRENT = "border-edge bg-island text-fg";

function Hint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2 max-sm:hidden" side="right">
        {label}
        {shortcut && <Key className="opacity-60">{shortcut}</Key>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The signed-in user's photo or initial. */
export function Avatar({ size = 28 }: { size?: number }) {
  const { dashboard } = dashboardRoute.useRouteContext();
  return <PersonAvatar person={dashboard.user} size={size} />;
}

function RailItem({ place, current }: { place: Destination; current: boolean }) {
  const { dashboard } = dashboardRoute.useRouteContext();
  const className = `${ITEM} ${current ? CURRENT : IDLE}`;
  const Icon = place.icon;
  // The avatar carries an electric dot while invitations wait on the account page.
  const content = Icon ? (
    <Icon size={18} />
  ) : (
    <span className="relative">
      <Avatar size={20} />
      {dashboard.invitations > 0 && (
        <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-electric ring-2 ring-ink" />
      )}
    </span>
  );
  return (
    <Hint label={place.label} shortcut={place.key}>
      {"to" in place ? (
        <Link
          aria-current={current ? "page" : undefined}
          aria-label={place.label}
          className={className}
          to={place.to}
        >
          {content}
        </Link>
      ) : (
        <a aria-label={place.label} className={className} href={place.href}>
          {content}
        </a>
      )}
    </Hint>
  );
}

/**
 * Every signed-in page: a rail of icons on the left (at the bottom on phones) and the page in a
 * centered column. The number keys go to the rail's places, T switches the theme.
 */
export function DashboardShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const { target } = event;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"))
        return;
      const place = PLACES.find((candidate) => candidate.key === event.key);
      if (!place) return;
      event.preventDefault();
      if ("to" in place) void navigate({ to: place.to });
      else window.location.assign(place.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="min-h-svh">
      <nav
        aria-label="Principal"
        className="fixed z-30 flex items-center bg-ink max-sm:inset-x-0 max-sm:bottom-0 max-sm:h-14 max-sm:justify-center sm:inset-y-0 sm:left-0 sm:w-16 sm:flex-col sm:py-3"
      >
        {/* `/?site` is the edge's switch to the marketing site for a signed-in visitor. */}
        <Hint label="Sitio de Códice">
          <a aria-label="Sitio de Códice" className={`${ITEM} ${IDLE} max-sm:hidden`} href="/?site">
            <Mark className="size-[18px]" strokeWidth={1.5} />
          </a>
        </Hint>
        <div className="flex items-center gap-2 max-sm:gap-6 sm:flex-1 sm:flex-col sm:justify-center">
          {PLACES.map((place) => (
            <RailItem
              current={"to" in place && pathname === place.to}
              key={place.key}
              place={place}
            />
          ))}
        </div>
        <Hint label="Tema" shortcut="T">
          <button
            aria-label="Cambiar entre tema claro y oscuro"
            className={`${ITEM} ${IDLE} max-sm:hidden`}
            onClick={() => toggleTheme()}
            type="button"
          >
            <IconContrast size={18} />
          </button>
        </Hint>
      </nav>
      <main className="max-sm:pb-14 sm:pl-16">
        <div className="mx-auto w-full max-w-[42rem] px-4 sm:px-6">{children}</div>
      </main>
    </div>
  );
}
