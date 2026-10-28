import {
  IconBook,
  IconBubble2,
  IconContrast,
  IconKey2,
  IconPlugin1,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { Link, getRouteApi, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, type ComponentType, type ReactNode } from "react";

import { Mark } from "../brand/mark";
import { toggleTheme } from "../theme";
import { Key } from "./ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Destination = { label: string; key: string } & (
  | { to: "/" | "/keys" | "/clients" | "/account"; icon?: ComponentType<{ size?: number }> }
  | { href: string; icon: ComponentType<{ size?: number }> }
);

// The rail's places, in order, each on its number key. The account is the avatar, last.
const CHAT: Destination = { to: "/", label: "Chat", key: "1", icon: IconBubble2 };
const KEYS: Destination = { to: "/keys", label: "Claves", key: "2", icon: IconKey2 };
const CLIENTS: Destination = { to: "/clients", label: "Clientes", key: "3", icon: IconPlugin1 };
const DOCS: Destination = { href: "/docs", label: "Documentación", key: "4", icon: IconBook };
const ACCOUNT: Destination = { to: "/account", label: "Cuenta", key: "5" };
const PLACES = [CHAT, KEYS, CLIENTS, DOCS, ACCOUNT];

const dashboardRoute = getRouteApi("/_dashboard");

// A rail button: a 40px square that, for the current page, takes the island's look.
const ITEM =
  "grid size-10 place-items-center rounded-[4px] border outline-none focus-visible:border-fg";
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

/** The user's photo, or the first letter of their name in a hairline circle. */
export function Avatar({ size = 28 }: { size?: number }) {
  const { dashboard } = dashboardRoute.useRouteContext();
  const { name, email, image } = dashboard.user;
  const style = { width: size, height: size };
  if (image) {
    return <img alt="" className="rounded-full object-cover" src={image} style={style} />;
  }
  return (
    <span
      className="grid place-items-center rounded-full border border-current/40 text-[12px] font-bold"
      style={style}
    >
      {(name.trim() || email).charAt(0).toLocaleUpperCase("es")}
    </span>
  );
}

function RailItem({ place, current }: { place: Destination; current: boolean }) {
  const className = `${ITEM} ${current ? CURRENT : IDLE}`;
  const Icon = place.icon;
  const content = Icon ? <Icon size={18} /> : <Avatar size={22} />;
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
