// The dashboard's few shapes, in the site's language (apps/app/DESIGN.md): islands for a page's
// content, fields and buttons sharp and small.
import {
  IconCheckmark1Small,
  IconSquareBehindSquare1,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { useState, type ReactNode } from "react";

/** Where the public API and MCP answer, as the docs give it. */
export const ORIGIN = "https://codice.io";

/** Dates in rows: "28 oct 2026". */
export const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

/** Where a page's content sits: white and borderless by day, the ground with a hairline at night. */
export const ISLAND = "rounded-[4px] border border-edge bg-island";

/** A text field: a grey well on a white island by day, a hairline box at night. */
export const FIELD =
  "h-8 min-w-0 rounded-[2px] border border-edge bg-ink px-2.5 outline-none placeholder:text-muted focus:border-fg disabled:text-muted";

const BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[2px] px-3 text-[13px] disabled:pointer-events-none disabled:opacity-50";
export const PRIMARY = `${BUTTON} bg-electric text-white hover:bg-fg hover:text-ink`;
export const SECONDARY = `${BUTTON} border border-edge bg-ink hover:border-fg`;
/** Raw text that brightens on hover, for a row's quiet action. */
export const GHOST = "text-[13px] text-muted hover:text-fg disabled:opacity-50";

/** A page: its title, then its islands, in the center column. */
export function Page({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 py-10 sm:py-16">
      <header className="flex min-h-8 items-center justify-between gap-4">
        <h1 className="text-[20px] leading-snug">{title}</h1>
        {action}
      </header>
      {children}
    </div>
  );
}

/**
 * A one-line row's padding: 16px from the edges to the letters. Radio Grotesk at 14px on a 20px
 * line leaves 4.5px over the capitals and 5.5px under the baseline, so the box pads 12px and 10px.
 */
export const ROW = "px-4 pt-3 pb-2.5 leading-5";

/**
 * An island in Transitive's settings style: its name (and an optional `muted` note at the right)
 * as its first row, then its blocks, divided edge to edge.
 */
export function Group({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`${ISLAND} flex flex-col divide-y divide-line/60 overflow-hidden`}>
      <div className={`flex items-baseline justify-between gap-4 ${ROW}`}>
        <h2>{title}</h2>
        {note && <span className="text-[13px] text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** One island with its name in bold and, optionally, a quiet note beside it. */
export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`${ISLAND} flex flex-col gap-4 p-4 sm:p-6`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2>{title}</h2>
        {note && <span className="text-[13px] text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** The site's key cap: a hairline box, small muted text. */
export function Key({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border border-current/30 px-1 font-sans text-[11px] ${className}`}
    >
      {children}
    </kbd>
  );
}

/** Something to copy: the value in the mono, in a well, with its copy button. */
export function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[2px] border border-edge bg-ink py-1 pr-1 pl-2.5">
      <code className="min-w-0 flex-1 font-mono text-[12px] break-all">{value}</code>
      <button
        aria-label={copied ? "Copiado" : `Copiar ${label}`}
        className="grid size-7 shrink-0 place-items-center text-muted hover:text-fg"
        onClick={() => void copy()}
        type="button"
      >
        {copied ? <IconCheckmark1Small size={16} /> : <IconSquareBehindSquare1 size={16} />}
      </button>
    </div>
  );
}
