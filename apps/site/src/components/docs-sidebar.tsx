import {
  IconChevronDownSmall,
  IconCode,
  IconContrast,
  IconMagnifyingGlass,
  IconPlugin1,
  IconRocket,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { useLocation } from "@tanstack/react-router";
import type { Folder, Item, Root } from "fumadocs-core/page-tree";
import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useState, type ComponentType, type ReactNode } from "react";

import { toggleTheme } from "../theme";

type Group = { name: ReactNode; key: string; pages: Item[] };

// Each group's line icon, in the order of content/docs/meta.json: Empezar, Conectar, Referencia
// de la API. (The tree's names arrive as React nodes, so groups are known by position.)
const ICONS: ComponentType<{ size?: number }>[] = [IconRocket, IconPlugin1, IconCode];

// The page tree as the sidebar's groups: each separator opens a group of the pages after it, and
// a folder (the API reference) is a group of its own.
function groupsOf(tree: Root): Group[] {
  const groups: Group[] = [];
  for (const node of tree.children) {
    if (node.type === "separator") {
      groups.push({ name: node.name, key: `group-${groups.length}`, pages: [] });
    } else if (node.type === "folder") {
      const folder = node as Folder;
      const pages = folder.children.filter((child): child is Item => child.type === "page");
      groups.push({
        name: folder.name,
        key: `group-${groups.length}`,
        pages: folder.index ? [folder.index, ...pages] : pages,
      });
    } else if (node.type === "page") {
      groups.at(-1)?.pages.push(node);
    }
  }
  return groups;
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-line px-1.5 py-1 text-[11px] text-muted">
      {children}
    </kbd>
  );
}

/**
 * The docs' sidebar (Figma node 8:4): a search row, then one hairline-separated row per group with
 * its line icon and a chevron that opens its pages, and the theme toggle at the foot. The group of
 * the page being read starts open.
 */
export function DocsSidebar({ tree }: { tree: Root }) {
  const { pathname } = useLocation();
  const { setOpenSearch } = useSearchContext();
  const groups = groupsOf(tree);
  const current = groups.find((group) => group.pages.some((page) => page.url === pathname));
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current.key] : []));

  function toggle(key: string) {
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <aside className="flex h-full flex-col lg:border-r lg:border-line">
      <button
        className="group flex h-[52px] shrink-0 items-center gap-3 border-b border-line px-4 text-muted hover:text-fg"
        onClick={() => setOpenSearch(true)}
        type="button"
      >
        <IconMagnifyingGlass size={16} />
        <span className="flex-1 text-left">Buscar</span>
        <Key>⌘K</Key>
      </button>

      <nav aria-label="Documentación" className="flex-1 overflow-y-auto">
        {groups.map((group, index) => {
          const Icon = ICONS[index] ?? IconCode;
          const isOpen = open.has(group.key);
          return (
            <div className="border-b border-line" key={group.key}>
              <button
                aria-expanded={isOpen}
                className="group flex h-[52px] w-full items-center gap-3 px-4 text-fg"
                onClick={() => toggle(group.key)}
                type="button"
              >
                <span className="text-muted group-hover:text-fg">
                  <Icon size={16} />
                </span>
                <span className="flex-1 text-left">{group.name}</span>
                <span
                  className={`text-muted transition-transform duration-200 group-hover:text-fg ${isOpen ? "rotate-180" : ""}`}
                >
                  <IconChevronDownSmall size={16} />
                </span>
              </button>
              {isOpen && (
                <ul className="flex flex-col pb-3">
                  {group.pages.map((page) => {
                    const active = page.url === pathname;
                    return (
                      <li key={page.url}>
                        <a
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center py-1.5 pr-4 pl-11 ${active ? "font-bold text-fg" : "text-muted hover:text-fg"}`}
                          href={page.url}
                        >
                          {page.name}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex h-[52px] shrink-0 items-center justify-end border-t border-line px-4">
        <button
          aria-label="Cambiar entre tema claro y oscuro"
          className="text-muted hover:text-fg"
          onClick={() => toggleTheme()}
          title="Tema (T)"
          type="button"
        >
          <IconContrast size={16} />
        </button>
      </div>
    </aside>
  );
}
