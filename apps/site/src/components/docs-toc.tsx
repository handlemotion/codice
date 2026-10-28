import { useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type Heading = { id: string; text: string };

/**
 * The page's table of contents, floating to the right of the text: its `##` headings,
 * read from the rendered page (guides and API operations alike), the one being read in the ink.
 */
export function DocsToc() {
  const { pathname } = useLocation();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [current, setCurrent] = useState<string>();

  useEffect(() => {
    let elements: HTMLElement[] = [];
    // A heading's own text (in its anchor, or bare), without its copy button's label.
    const textOf = (element: HTMLElement) =>
      element.querySelector("a")?.textContent ??
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join("")
        .trim();
    // The guide renders after its body loads, so the headings are read again whenever it changes.
    const collect = () => {
      elements = [...document.querySelectorAll<HTMLElement>("main h2[id]")];
      setHeadings(elements.map((element) => ({ id: element.id, text: textOf(element) })));
      update();
    };
    // The current heading is the last one above a line a fifth of the way down the window.
    const update = () => {
      const line = window.innerHeight / 5;
      const above = elements.filter((element) => element.getBoundingClientRect().top < line);
      setCurrent((above.at(-1) ?? elements[0])?.id);
    };
    const main = document.querySelector("main");
    const observer = new MutationObserver(collect);
    if (main) observer.observe(main, { childList: true, subtree: true });
    collect();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [pathname]);

  if (headings.length === 0) return null;
  return (
    <nav aria-label="En esta página" className="flex flex-col gap-3">
      <span className="text-muted">En esta página</span>
      <ul className="flex flex-col gap-1.5">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              className={heading.id === current ? "text-fg" : "text-muted hover:text-fg"}
              href={`#${heading.id}`}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
