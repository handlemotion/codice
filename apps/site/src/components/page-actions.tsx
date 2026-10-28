import {
  IconArrowUpRight,
  IconCheckmark1Small,
  IconClipboard,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { useEffect, useState } from "react";

// Each guide's source, loaded only when someone copies it.
const SOURCES = import.meta.glob<string>("../../content/docs/**/*.mdx", {
  query: "?raw",
  import: "default",
});

// The guide as Markdown: its title, then its body without the frontmatter.
async function markdownOf(path: string, title: string) {
  const load = SOURCES[`../../content/docs/${path}`];
  if (!load) return null;
  const body = (await load()).replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  return `# ${title}\n\n${body}\n`;
}

// Ghost buttons: no box until hovered, then the hairline's tone behind the ink. The negative
// margin keeps their labels in line with the text above them.
const ROW =
  "-mx-2 inline-flex h-8 items-center gap-2 rounded-[2px] px-2 text-left text-muted hover:bg-line hover:text-fg";

/**
 * What a reader can do with a guide: copy it as Markdown or open it in an assistant with a prompt
 * to read it.
 */
export function PageActions({
  className = "",
  path,
  title,
}: {
  className?: string;
  path: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(window.location.origin + window.location.pathname), [path, title]);
  const prompt = encodeURIComponent(`Lee ${url} para responder mis preguntas sobre Códice.`);

  async function copy() {
    const markdown = await markdownOf(path, title);
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <ul aria-label="Acciones de la página" className={`flex gap-1 ${className}`}>
      <li>
        <button className={ROW} onClick={copy} type="button">
          {copied ? <IconCheckmark1Small size={16} /> : <IconClipboard size={16} />}
          {copied ? "Copiado" : "Copiar como Markdown"}
        </button>
      </li>
      <li>
        <a
          className={ROW}
          href={`https://chatgpt.com/?hints=search&q=${prompt}`}
          rel="noreferrer"
          target="_blank"
        >
          <IconArrowUpRight size={16} />
          Abrir en ChatGPT
        </a>
      </li>
      <li>
        <a
          className={ROW}
          href={`https://claude.ai/new?q=${prompt}`}
          rel="noreferrer"
          target="_blank"
        >
          <IconArrowUpRight size={16} />
          Abrir en Claude
        </a>
      </li>
    </ul>
  );
}
