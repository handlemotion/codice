import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";

import { Mark, WAVE_MS } from "./brand/mark";

// The site's own `POST /_site/chat`, which calls the API's `POST /v1/chat` with the site's key
// (src/routes/[_site]/chat.ts). The answer streams back as AG-UI server-sent events.
const connection = fetchServerSentEvents("/_site/chat");

// Questions the composer offers as ghost text: Tab takes one.
const SUGGESTIONS = [
  "¿Hasta cuándo puedo cancelar un CFDI?",
  "¿Qué significa el error CFDI40149?",
  "¿Para qué es el uso de CFDI G03?",
  "¿Qué pide la regla 2.7.1.34 de la RMF?",
];
const ROTATE_MS = 4000;

/** Matches the API's limit on one question (`CHAT_MAX_BODY_BYTES` bounds the whole conversation). */
const MAX_QUESTION_LENGTH = 2000;

// What Códice is doing while a tool runs, beside its rolling shapes.
const TOOL_LABELS: Record<string, string> = {
  search: "Buscando en las reglas del SAT",
  read_passage: "Leyendo la regla",
  lookup_error: "Consultando la matriz de errores",
  lookup_catalog: "Consultando el catálogo",
  list_sources: "Revisando las fuentes",
};

// The answer's markdown, in the page's own type and the thread's inverted inks: links underlined,
// lists and paragraphs spaced.
const ANSWER =
  "[&_a]:underline [&_a]:decoration-ink/30 [&_a]:underline-offset-4 [&_a:hover]:decoration-ink [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5";

// The thread's two sizes: the pill 32px off the bottom of the window, and the open thread.
const PILL = { width: 88, height: 36 };
const BOTTOM = 32;
const PILL_REST_MS = 900; // the least time the pill rests before the thread opens by itself
const THREAD_WIDTH = 544; // 34rem, the chat's column
const GUTTER = 16;
const THREAD_HEIGHT = 0.7; // of the window

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

// Key caps live only on inverted boxes (`bg-fg`), so they use the ground's ink.
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-ink/25 px-1.5 py-1 text-[11px] text-ink/60">
      {children}
    </kbd>
  );
}

/** Three marks rolling left to right, a wave like the hero's field, while `animate`. */
function Marks({ animate }: { animate: boolean }) {
  return (
    <span aria-hidden className="flex gap-1.5">
      {[0, 1, 2].map((index) => (
        <Mark
          animate={animate}
          className="size-3.5"
          key={index}
          lag={index * WAVE_MS}
          strokeWidth={1.5}
        />
      ))}
    </span>
  );
}

/**
 * The question leaving the composer: a drop of the composer's ink pulls out of its bottom edge
 * and falls to where the pill rests. Drawn through a gooey filter (blur, then a hard alpha
 * threshold) so the drop and the composer stay joined by a neck until they part.
 */
function Launch({ from, onDone }: { from: DOMRect; onDone: () => void }) {
  const drop = useRef<HTMLDivElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  // The filter only covers the path from the composer's bottom edge to the pill's resting place
  // (plus the blur's reach), so the browser blurs a small box each frame, not the whole window.
  const cx = from.left + from.width / 2;
  const reach = 24;
  const box = {
    left: Math.min(cx, window.innerWidth / 2) - PILL.width / 2 - reach,
    top: from.bottom - PILL.height - reach,
    right: Math.max(cx, window.innerWidth / 2) + PILL.width / 2 + reach,
    bottom: window.innerHeight - BOTTOM + reach,
  };
  const x = cx - box.left;
  const y = from.bottom - box.top;

  useLayoutEffect(() => {
    const dx = window.innerWidth / 2 - cx;
    const dy = window.innerHeight - BOTTOM - from.bottom;
    const fall = drop.current?.animate(
      [
        { transform: "translate(0, 0) scale(1, 1)" },
        { transform: "translate(0, 22px) scale(0.82, 1.12)", offset: 0.3 },
        { transform: `translate(${dx}px, ${dy}px) scale(1, 1)` },
      ],
      { duration: 720, easing: "cubic-bezier(0.6, 0, 0.2, 1)", fill: "forwards" },
    );
    tail.current?.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(0.35)`, opacity: 0 },
      ],
      { duration: 640, delay: 90, easing: "cubic-bezier(0.6, 0, 0.2, 1)", fill: "forwards" },
    );
    if (fall) fall.onfinish = () => done.current();
    else done.current();
  }, []);

  return createPortal(
    <>
      <svg aria-hidden className="absolute size-0">
        <filter id="goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" />
        </filter>
      </svg>
      <div
        aria-hidden
        className="pointer-events-none fixed z-50 [filter:url(#goo)]"
        style={{
          left: box.left,
          top: box.top,
          width: box.right - box.left,
          height: box.bottom - box.top,
        }}
      >
        {/* A strip of the composer's own bottom edge, the same ink, for the drop to pull from. */}
        <div className="absolute h-3 w-24 bg-fg" style={{ left: x - 48, top: y - 12 }} />
        <div
          className="absolute size-7 rounded-full bg-fg will-change-transform"
          ref={tail}
          style={{ left: x - 14, top: y - 28 }}
        />
        <div
          className="absolute rounded-full bg-fg will-change-transform"
          ref={drop}
          style={{ left: x - PILL.width / 2, top: y - PILL.height, ...PILL }}
        />
      </div>
    </>,
    document.body,
  );
}

/**
 * The asked question, floating 32px off the bottom of the window. While Códice answers it is a
 * pill of three rolling marks; when the answer is complete, or when the visitor clicks it, it
 * opens into the thread: the question and the answer, streaming if it is not done yet.
 */
function Thread({
  question,
  answer,
  status,
  loading,
  failed,
  expanded,
  onExpand,
  onCollapse,
  onClose,
}: {
  question: string;
  answer: string;
  status: string | null;
  loading: boolean;
  failed: boolean;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ width: THREAD_WIDTH, height: 0, max: 600, scrollbar: 0 });

  // The open thread is as tall as what it holds, up to 70% of the window; it keeps to the
  // bottom of the answer while it streams, unless the visitor scrolled up.
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const measure = () => {
      const scroller = box.current;
      const pinned = scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24
        : true;
      setView({
        width: Math.min(THREAD_WIDTH, window.innerWidth - GUTTER * 2),
        height: element.offsetHeight,
        max: window.innerHeight * THREAD_HEIGHT,
        // A classic scrollbar takes room from the content; overlay scrollbars take none.
        scrollbar: window.innerWidth - document.documentElement.clientWidth,
      });
      if (pinned && scroller) scroller.scrollTop = scroller.scrollHeight;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // A click anywhere else folds the open thread back into its pill.
  useEffect(() => {
    if (!expanded) return;
    const onPointer = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) onCollapse();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [expanded, onCollapse]);

  // It scrolls only when the answer outgrows 70% of the window.
  const scrolls = expanded && view.height > view.max;
  const size = expanded
    ? { width: view.width, height: Math.min(view.height, view.max), borderRadius: 4 }
    : { ...PILL, borderRadius: PILL.height / 2 };

  return createPortal(
    <div
      aria-live="polite"
      className="fixed left-1/2 z-40 -translate-x-1/2 overscroll-contain bg-fg text-ink transition-[width,height,border-radius] duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] motion-reduce:transition-none"
      ref={box}
      style={{
        ...size,
        bottom: BOTTOM,
        overflowX: "hidden",
        overflowY: scrolls ? "auto" : "hidden",
      }}
    >
      {!expanded && (
        <button
          aria-label={loading ? "Ver la respuesta mientras llega" : "Ver la respuesta"}
          className="absolute inset-0 flex items-center justify-center"
          onClick={onExpand}
          type="button"
        >
          <Marks animate={loading} />
        </button>
      )}
      {/* Laid out at the open width all along, so opening only uncovers it. */}
      <div
        aria-hidden={!expanded}
        className="flex flex-col gap-4 p-4 transition-opacity duration-200"
        ref={content}
        style={{ width: view.width - (scrolls ? view.scrollbar : 0), opacity: expanded ? 1 : 0 }}
      >
        <p className="max-w-[80%] self-end rounded-[4px] bg-electric px-3 py-2 text-white">
          {question}
        </p>
        <div className="flex items-center gap-3">
          <Marks animate={loading} />
          {status && (
            <span className="text-ink/60" role="status">
              {status}
            </span>
          )}
          <button
            className="ml-auto flex items-center gap-2 text-ink/60 hover:text-ink"
            onClick={onClose}
            tabIndex={expanded ? 0 : -1}
            type="button"
          >
            <Key>Esc</Key>
            {loading ? "Detener" : "Cerrar"}
          </button>
        </div>
        {answer && (
          <Streamdown className={ANSWER} isAnimating={loading}>
            {answer}
          </Streamdown>
        )}
        {failed && <p className="text-ink/60">No pude responder. Intenta de nuevo en un minuto.</p>}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The chat of the first screen: a composer that offers questions. A sent question leaves the
 * composer as a gooey drop and rests as a pill at the bottom of the window while Códice answers;
 * the pill opens into the thread when the answer is complete or when it is clicked. One question,
 * one answer: a new question replaces it, and Esc closes it.
 */
export function Ask() {
  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({ connection });
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(0);
  const [launch, setLaunch] = useState<{ from: DOMRect; key: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const open = messages.length > 0 || isLoading;
  const ghost = completion(query, rotation);
  const rest = ghost?.slice(query.length) ?? "";

  const question =
    messages
      .find((message) => message.role === "user")
      ?.parts.map((part) => (part.type === "text" ? part.content : ""))
      .join("") ?? "";
  // One question, one answer: the reply is the last message once Códice starts answering.
  const last = messages.at(-1);
  const reply = last?.role === "assistant" ? last : undefined;

  // While nothing is typed, the offered question changes every few seconds.
  useEffect(() => {
    if (query) return;
    const timer = setInterval(() => setRotation((count) => count + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [query]);

  // The thread opens by itself once the answer is complete, but only after the pill has rested
  // a moment, so an answer that fails at once still shows where it went.
  const autoOpen = useRef(false);
  useEffect(() => {
    if (!autoOpen.current || !open || isLoading || launch) return;
    const timer = setTimeout(() => {
      autoOpen.current = false;
      setExpanded(true);
    }, PILL_REST_MS);
    return () => clearTimeout(timer);
  }, [open, isLoading, launch]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Only what is typed is sent: an offered question is taken with Tab first.
    const text = query.trim();
    if (!text) return;
    if (open) {
      stop();
      clear();
    }
    setQuery("");
    setExpanded(false);
    autoOpen.current = true;
    const from = form.current?.getBoundingClientRect();
    setLaunch(from && !reducedMotion() ? { from, key: Date.now() } : null);
    void sendMessage(text);
  }

  function close() {
    stop();
    clear();
    setExpanded(false);
    setLaunch(null);
    autoOpen.current = false;
    requestAnimationFrame(() => input.current?.focus());
  }

  // `/` anywhere focuses the composer; Esc closes the thread, whatever it holds.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
        input.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (event.key === "Escape") {
        if (open) close();
        else input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The tool Códice is running now, if any: a call with no part after it yet.
  const parts = reply?.parts ?? [];
  const tail = parts.at(-1);
  const running =
    tail?.type === "tool-call" && tail.state !== "complete" && tail.state !== "error"
      ? tail
      : undefined;
  const answer = parts.map((part) => (part.type === "text" ? part.content : "")).join("");
  const status = running
    ? (TOOL_LABELS[running.name] ?? "Consultando")
    : isLoading && !answer
      ? "Pensando"
      : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="self-start bg-ink text-[20px] leading-snug text-balance">
        Códice es el primer índice de documentación legal mexicana.
      </h1>

      <form className="rounded-[4px] bg-fg text-ink" onSubmit={onSubmit} ref={form} role="search">
        <label className="sr-only" htmlFor="ask">
          Pregúntale a Códice
        </label>
        <div className="relative flex items-center gap-3 px-3 py-2">
          {/* The ghost: what is typed, invisible, then the rest of the offered question. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-2 right-24 left-3 overflow-hidden whitespace-pre"
          >
            <span className="invisible">{query}</span>
            <span className="text-ink/50">{rest}</span>
          </div>
          <input
            autoComplete="off"
            className="relative min-w-0 flex-1 bg-transparent caret-ink outline-none"
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
          <span className="flex gap-1.5 max-sm:hidden">
            {rest && <Key>Tab</Key>}
            {query.trim() && <Key>↵</Key>}
          </span>
        </div>
      </form>

      {launch && <Launch from={launch.from} key={launch.key} onDone={() => setLaunch(null)} />}
      {open && !launch && (
        <Thread
          answer={answer}
          expanded={expanded}
          failed={Boolean(error) && !isLoading}
          loading={isLoading}
          onClose={close}
          onCollapse={() => setExpanded(false)}
          onExpand={() => {
            autoOpen.current = false;
            setExpanded(true);
          }}
          question={question}
          status={status}
        />
      )}
    </div>
  );
}
