import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  IconArrowCornerDownLeft,
  IconArrowRotateCounterClockwise,
  IconCheckmark1Small,
  IconSquareBehindSquare1,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Streamdown } from "streamdown";

import { Mark } from "./brand/mark";
import { Bubble } from "./components/chat/bubble";
import { useStreamedReveal } from "./components/chat/streamed-reveal";
import { Tooltip, TooltipContent, TooltipTrigger } from "./components/ui/tooltip";

// The site's own `POST /_site/chat`, which calls the API's `POST /v1/chat` with the site's key
// (src/routes/[_site]/chat.ts). The answer streams back as AG-UI server-sent events.
const connection = fetchServerSentEvents("/_site/chat");

// Questions the composer offers as ghost text: Tab takes one, Enter on an empty composer sends it.
const SUGGESTIONS = [
  "¿Hasta cuándo puedo cancelar una factura?",
  "¿Qué significa el error CFDI40149?",
  "¿Qué uso de CFDI pongo en gastos médicos?",
  "¿Qué régimen fiscal es el 626?",
];
const ROTATE_MS = 4000;

/** Matches the API's limit on one question (`CHAT_MAX_BODY_BYTES` bounds the whole conversation). */
const MAX_QUESTION_LENGTH = 2000;

// The answer's markdown, in the page's own type: links underlined, lists and paragraphs spaced,
// inline code (a key, an error code) in the mono on an electric tint, its text the accent mixed
// toward `fg` so it reads on either theme. Tailwind never sees Streamdown's own classes.
const ANSWER =
  "[&_a]:underline [&_a]:decoration-line [&_a]:underline-offset-4 [&_a:hover]:decoration-fg [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_[data-streamdown=inline-code]]:rounded-[2px] [&_[data-streamdown=inline-code]]:bg-electric/15 [&_[data-streamdown=inline-code]]:px-1 [&_[data-streamdown=inline-code]]:py-0.5 [&_[data-streamdown=inline-code]]:text-[12px] [&_[data-streamdown=inline-code]]:text-[color-mix(in_oklab,var(--color-electric),var(--color-fg)_45%)]";

// The small raw-text hint under the composer: how to send it.
const HINT = "flex items-center gap-1.5 text-[13px] text-muted";

// The icon actions under an answer: copy it, start over.
const ACTION = "flex size-7 items-center justify-center text-muted hover:text-fg";

type ChatMessage = ReturnType<typeof useChat>["messages"][number];
type Part = ChatMessage["parts"][number];

// Compared without case or accents, so "hasta cuando" still finds "Hasta cuándo". Stripping marks
// after NFD keeps one character per letter, so the two strings stay aligned.
function fold(text: string) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es");
}

// The suggestion that completes what is typed so far (with or without its opening ¿), as the
// form whose length lines up with the query; any one while it is empty.
function completion(query: string, rotation: number): string | null {
  if (!query) return SUGGESTIONS[rotation % SUGGESTIONS.length] ?? null;
  const typed = fold(query);
  for (const suggestion of SUGGESTIONS) {
    for (const form of [suggestion, suggestion.replace(/^¿/, "")]) {
      if (fold(form).startsWith(typed)) return form;
    }
  }
  return null;
}

function textOf(parts: readonly Part[]) {
  return parts.map((part) => (part.type === "text" ? part.content : "")).join("");
}

type Source = { title: string; url: string; section: string; since: string };

// The line that opens the answer's sources: "Fuente:", bold or not, with the colon in or out.
const SOURCES_LINE = /^\s*[*_]{0,2}fuentes?(?::[*_]{0,2}|[*_]{0,2}:)\s*/i;
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)([^[]*)/g;

/**
 * Splits the `Fuente:` block the API ends each answer with (apps/api/src/chat.ts) off the body:
 * each linked document becomes a source, with the section and the date after its link. Without
 * links the block stays in the body. While the answer streams, a last line that is still
 * becoming "Fuente:" is held back, so it never shows as text.
 */
function splitSources(text: string, live: boolean): { body: string; sources: Source[] } {
  const lines = text.split("\n");
  let start = lines.length - 1;
  while (start >= 0 && !SOURCES_LINE.test(lines[start]!)) start--;
  if (start === -1) {
    const tail = fold(lines.at(-1)?.replace(/[*_\s]/g, "") ?? "");
    const held = live && tail.length > 0 && "fuente:".startsWith(tail);
    return { body: held ? lines.slice(0, -1).join("\n") : text, sources: [] };
  }
  const block = [lines[start]!.replace(SOURCES_LINE, ""), ...lines.slice(start + 1)].join("\n");
  const sources = [...block.matchAll(LINK)].map(([, title = "", url = "", after = ""]) => {
    const [section = "", ...rest] = after
      .replace(/^[\s,;:–—-]+|[\s.;]+$/g, "")
      .split(/,\s*(?=vigente)/i);
    return { title, url, section: section.trim(), since: rest.join(", ").trim() };
  });
  if (!sources.length && !live) return { body: text, sources: [] };
  return { body: lines.slice(0, start).join("\n").trimEnd(), sources };
}

/**
 * Códice's three shapes, turning while it works: twice the page's pace while it only thinks. No
 * words beside them, so the row keeps one size from the first token to the last.
 */
function Working({ tool }: { tool: boolean }) {
  return (
    <span aria-label="Respondiendo" className="flex gap-1.5" role="status">
      {[0, 1, 2].map((step) => (
        <Mark className="size-3.5" key={step} speed={tool ? 1 : 2} step={step} strokeWidth={1.5} />
      ))}
    </span>
  );
}

/**
 * One answer: the shapes while Códice works, then the answer revealed at
 * a steady pace. Memoized, so a streamed token re-renders only the answer it extends.
 */
const Answer = memo(function Answer({
  parts,
  live,
  failed,
}: {
  parts: readonly Part[];
  live: boolean;
  failed: boolean;
}) {
  const reveal = useStreamedReveal(textOf(parts), live);
  const { body } = splitSources(reveal.text, live);
  // The tool Códice is running now, if any: a call with no part after it yet.
  const tail = parts.at(-1);
  const running =
    live && tail?.type === "tool-call" && tail.state !== "complete" && tail.state !== "error"
      ? tail
      : undefined;
  return (
    <div className="flex flex-col gap-3">
      {live && <Working tool={Boolean(running)} />}
      {body && (
        <Streamdown className={ANSWER} isAnimating={reveal.revealing}>
          {body}
        </Streamdown>
      )}
      {failed && <p className="text-muted">No pude responder. Intenta de nuevo en un minuto.</p>}
    </div>
  );
});

/**
 * The chat of the first screen: one question, one answer. The composer is the visitor's bubble,
 * grey, on the right under the title; Enter sends it where it stands and Códice answers under it,
 * in the page's own flow: the first screen grows with a long answer. Under the answer,
 * icon actions (copy, start over; Esc too) and, past a divider, the sources as pills.
 */
export function Ask() {
  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({ connection });
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const open = messages.length > 0 || isLoading;
  const ghost = completion(query, rotation);
  const rest = ghost?.slice(query.length) ?? "";
  const last = messages.at(-1);
  const pending = isLoading && last?.role === "user";
  const answer = last?.role === "assistant" ? textOf(last.parts) : "";

  // While nothing is typed, the offered question changes every few seconds; it holds still while
  // the bubble has the keyboard, so the question there is the one Enter sends.
  useEffect(() => {
    if (query || isLoading) return;
    const timer = setInterval(() => {
      if (document.activeElement !== input.current) setRotation((count) => count + 1);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [query, isLoading]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim() || (ghost ?? "");
    if (!text || open) return;
    setQuery("");
    void sendMessage(text);
  }

  function reset() {
    stop();
    clear();
    setQuery("");
    setRotation((count) => count + 1);
    requestAnimationFrame(() => input.current?.focus());
  }

  // `/` anywhere focuses the composer; Esc starts over, whatever the chat holds.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
        input.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (event.key === "Escape") {
        if (open) reset();
        else input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-col gap-10">
      {/* Balanced, so its two lines run about the same length; the ground sits behind the lines only,
          so the field shows past where each line ends. */}
      <h1 className="text-[20px] leading-snug text-balance">
        <span className="box-decoration-clone bg-ink">
          Códice reúne la documentación fiscal de México para tus agentes. Conéctala a tu asistente
          o intégrala en tu producto.
        </span>
      </h1>

      <div aria-label="Conversación con Códice" className="flex flex-col gap-6" role="log">
        {messages.map((message, index) => (
          <div className="message-in" key={message.id}>
            {message.role === "user" ? (
              <Bubble>{textOf(message.parts)}</Bubble>
            ) : (
              <div className="mt-4 bg-ink">
                <Answer
                  failed={Boolean(error) && !isLoading && index === messages.length - 1}
                  live={isLoading && index === messages.length - 1}
                  parts={message.parts}
                />
              </div>
            )}
          </div>
        ))}
        {pending && (
          <div className="message-in mt-4">
            <Working tool={false} />
          </div>
        )}
        {error && !isLoading && last?.role === "user" && (
          <div className="mt-4">
            <p className="bg-ink text-muted">No pude responder. Intenta de nuevo en un minuto.</p>
          </div>
        )}
        {!open && (
          <div>
            <div className="flex flex-col items-end gap-2">
              <Composer
                input={input}
                label="Pregúntale a Códice"
                onSubmit={onSubmit}
                query={query}
                rest={rest}
                setQuery={setQuery}
              />
              {/* Under the bubble, in small raw text: how to send it. */}
              <span className={`${HINT} bg-ink`}>
                <IconArrowCornerDownLeft size={14} />
                Enviar
              </span>
            </div>
          </div>
        )}
        {/* One question, one answer: to keep talking, the visitor makes an account. Pulled up
            against the answer, so the row reads as its footer. */}
        {open && !isLoading && (
          <div className="message-in -mt-4">
            <Actions answer={answer} reset={reset} />
          </div>
        )}
      </div>
    </div>
  );
}

/** An icon action with its name in a tooltip. */
function Action({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The pill's label, in one form whatever the model wrote: no markdown, quotes or "apartado"
 * before it, only the last step of a heading path, one space between words, a capital first.
 */
function sourceLabel({ section, title }: Source) {
  const label = section
    .replace(/[*_`"“”«»]/g, "")
    .split(/\s+[>›/]\s+/)
    .at(-1)!
    .replace(/^(?:apartado|secci[oó]n)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:.–—-]+|[\s,;:.–—-]+$/g, "");
  const text = label || title;
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/**
 * Under the answer: copy it, start over, then past a divider each source it cites as a pill that
 * opens the document.
 */
function Actions({ answer, reset }: { answer: string; reset: () => void }) {
  const { sources } = splitSources(answer, false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="-ml-1.5 flex flex-wrap items-center gap-1">
      {answer && (
        <Action label={copied ? "Copiada" : "Copiar respuesta"}>
          <button
            aria-label="Copiar respuesta"
            className={ACTION}
            onClick={() => void navigator.clipboard.writeText(answer).then(() => setCopied(true))}
            type="button"
          >
            {copied ? <IconCheckmark1Small size={16} /> : <IconSquareBehindSquare1 size={16} />}
          </button>
        </Action>
      )}
      <Action label="Empezar de nuevo · Esc">
        <button aria-label="Empezar de nuevo" className={ACTION} onClick={reset} type="button">
          <IconArrowRotateCounterClockwise size={16} />
        </button>
      </Action>
      {sources.length > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-line" />}
      {sources.map((source) => (
        <Action
          key={source.url + source.section}
          label={source.since ? `${source.title}, ${source.since}` : source.title}
        >
          {/* Trimmed to cap height and baseline like a button, so the label centers; clipped
              sideways only, so the trim never cuts a descender. */}
          <a
            className="ml-1 flex h-7 max-w-64 min-w-0 items-center rounded-full border border-line bg-ink px-2.5 text-[12px] text-muted hover:border-fg hover:text-fg"
            href={source.url}
            rel="noreferrer"
            target="_blank"
          >
            <span className="overflow-x-clip text-ellipsis whitespace-nowrap [text-box:trim-both_cap_alphabetic]">
              {sourceLabel(source)}
            </span>
          </a>
        </Action>
      ))}
    </div>
  );
}

/**
 * The visitor's next message as a grey bubble (blue once sent): exactly as wide as what is typed
 * (and the offered question, as ghost text Tab accepts), up to 85% of the thread.
 */
function Composer({
  input,
  label,
  onSubmit,
  query,
  rest,
  setQuery,
}: {
  input: RefObject<HTMLInputElement | null>;
  label: string;
  onSubmit: (event: FormEvent) => void;
  query: string;
  rest: string;
  setQuery: (query: string) => void;
}) {
  // The text's width, measured from a hidden copy, sets the bubble's: an explicit width can
  // transition, so the bubble eases between the offered questions as they rotate. While the
  // visitor types it follows at once. Observed, not measured once, so it is measured again when
  // the web font replaces the fallback.
  const sizer = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const node = sizer.current;
    if (!node) return;
    const measure = () => setWidth(Math.ceil(node.getBoundingClientRect().width));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <form
      className="max-w-[85%] min-w-0 rounded-[4px] bg-line px-3 py-2 text-fg"
      onSubmit={onSubmit}
      role="search"
    >
      <label className="sr-only" htmlFor="ask">
        {label}
      </label>
      <span
        aria-hidden
        className="pointer-events-none invisible absolute whitespace-pre"
        ref={sizer}
      >
        {query + rest || " "}
      </span>
      <span
        className={`relative block max-w-full overflow-hidden ${query ? "" : "transition-[width] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"}`}
        style={{ width: width === undefined ? undefined : `max(4ch, ${width}px)` }}
      >
        {/* The ghost: what is typed, invisible, then the rest of the offered question. */}
        <span aria-hidden className="pointer-events-none absolute inset-0 whitespace-pre">
          <span className="invisible">{query}</span>
          <span className="text-muted">{rest}</span>
        </span>
        <input
          autoComplete="off"
          className="relative block w-full min-w-0 bg-transparent caret-fg outline-none"
          enterKeyHint="send"
          id="ask"
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Tab" && rest) {
              event.preventDefault();
              setQuery(query + rest);
            }
          }}
          ref={input}
          spellCheck={false}
          value={query}
        />
      </span>
    </form>
  );
}
