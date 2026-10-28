import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Streamdown } from "streamdown";

import { Mark } from "./brand/mark";
import { Bubble } from "./components/chat/bubble";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./components/chat/message-scroller";
import { useStreamedReveal } from "./components/chat/streamed-reveal";

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

// What Códice is doing while a tool runs, under its turning shapes.
const TOOL_LABELS: Record<string, string> = {
  search: "Buscando en las reglas del SAT",
  read_passage: "Leyendo la regla",
  lookup_error: "Consultando la matriz de errores",
  lookup_catalog: "Consultando el catálogo",
  list_sources: "Revisando las fuentes",
};

// The composer's trip from under the title to the bottom of the screen, and back.
const DOCK = { duration: 520, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };

// The answer's markdown, in the page's own type: links underlined, lists and paragraphs spaced.
const ANSWER =
  "[&_a]:underline [&_a]:decoration-line [&_a]:underline-offset-4 [&_a:hover]:decoration-fg [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5";

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

// Key caps live only inside the composer, which is inverted (`bg-fg`), so they use the ground's ink.
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-ink/25 px-1.5 py-1 text-[11px] text-ink/60">
      {children}
    </kbd>
  );
}

/** Códice's three shapes, turning while it works. */
function Working({ animate, status }: { animate: boolean; status: string | null }) {
  return (
    <span className="flex items-center gap-3">
      <span aria-hidden className="flex gap-1.5">
        {[0, 1, 2].map((step) => (
          <Mark animate={animate} className="size-3.5" key={step} step={step} strokeWidth={1.5} />
        ))}
      </span>
      {status && (
        <span className="text-muted" role="status">
          {status}
        </span>
      )}
    </span>
  );
}

/**
 * One answer: the shapes and what Códice is doing while it works, then the answer revealed at
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
  // The tool Códice is running now, if any: a call with no part after it yet.
  const tail = parts.at(-1);
  const running =
    live && tail?.type === "tool-call" && tail.state !== "complete" && tail.state !== "error"
      ? tail
      : undefined;
  const status = running
    ? (TOOL_LABELS[running.name] ?? "Consultando")
    : live && !reveal.text
      ? "Pensando"
      : null;
  return (
    <div className="flex flex-col gap-3">
      {live && <Working animate status={status} />}
      {reveal.text && (
        <Streamdown className={ANSWER} isAnimating={reveal.revealing}>
          {reveal.text}
        </Streamdown>
      )}
      {failed && <p className="text-muted">No pude responder. Intenta de nuevo en un minuto.</p>}
    </div>
  );
});

/**
 * The chat of the first screen. Before a question, the composer sits under the title; once one
 * is sent, it glides to the bottom of the screen and the conversation fills the space above it:
 * the visitor's questions as blue bubbles, Códice's answers on the ground, faded at whichever
 * edge has more to read. Esc starts over.
 */
export function Ask() {
  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({ connection });
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const from = useRef<number | null>(null);
  const open = messages.length > 0 || isLoading;
  const ghost = completion(query, rotation);
  const rest = isLoading ? "" : (ghost?.slice(query.length) ?? "");
  const last = messages.at(-1);
  const pending = isLoading && last?.role === "user";

  // While nothing is typed, the offered question changes every few seconds.
  useEffect(() => {
    if (query || isLoading) return;
    const timer = setInterval(() => setRotation((count) => count + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [query, isLoading]);

  // The composer moves when the conversation opens or closes: it is laid out at its new place,
  // then animated there from where it was (FLIP).
  useLayoutEffect(() => {
    const element = form.current;
    if (!element || from.current === null) return;
    const delta = from.current - element.getBoundingClientRect().top;
    from.current = null;
    if (delta === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate([{ transform: `translateY(${delta}px)` }, { transform: "none" }], DOCK);
  }, [open]);

  function remember() {
    from.current = form.current?.getBoundingClientRect().top ?? null;
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim() || (ghost ?? "");
    if (!text || isLoading) return;
    if (!open) remember();
    setQuery("");
    void sendMessage(text);
  }

  function reset() {
    stop();
    remember();
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
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <h1 className="text-[20px] leading-snug">
        <span className="box-decoration-clone bg-ink">
          Las reglas del SAT, con su fuente. Pregunta por un código de error, un uso de CFDI o un
          plazo de cancelación, y Códice te muestra la regla exacta, el documento donde está y desde
          cuándo aplica.
        </span>
      </h1>

      {open && (
        <MessageScrollerProvider autoScroll scrollPreviousItemPeek={64}>
          <MessageScroller>
            <MessageScrollerViewport aria-label="Conversación con Códice" role="log">
              <MessageScrollerContent className="py-6">
                {messages.map((message, index) => (
                  <MessageScrollerItem
                    className="message-in"
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    {message.role === "user" ? (
                      <Bubble>{textOf(message.parts)}</Bubble>
                    ) : (
                      <div className="bg-ink">
                        <Answer
                          failed={Boolean(error) && !isLoading && index === messages.length - 1}
                          live={isLoading && index === messages.length - 1}
                          parts={message.parts}
                        />
                      </div>
                    )}
                  </MessageScrollerItem>
                ))}
                {pending && (
                  <MessageScrollerItem className="message-in" messageId="pending">
                    <Working animate status="Pensando" />
                  </MessageScrollerItem>
                )}
                {error && !isLoading && last?.role === "user" && (
                  <MessageScrollerItem messageId="error">
                    <p className="bg-ink text-muted">
                      No pude responder. Intenta de nuevo en un minuto.
                    </p>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <form
        className="shrink-0 rounded-[4px] bg-fg text-ink"
        onSubmit={onSubmit}
        ref={form}
        role="search"
      >
        <label className="sr-only" htmlFor="ask">
          {open ? "Pregunta algo más" : "Pregúntale a Códice"}
        </label>
        <div className="relative flex items-center gap-3 px-3 py-2">
          {/* The ghost: what is typed, invisible, then the rest of the offered question. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-2 right-32 left-3 overflow-hidden whitespace-pre"
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
          {open ? (
            <button
              className="flex shrink-0 items-center gap-2 text-ink/60 hover:text-ink"
              onClick={reset}
              type="button"
            >
              <Key>Esc</Key>
              {isLoading ? "Detener" : "Empezar de nuevo"}
            </button>
          ) : (
            <span className="flex gap-1.5 max-sm:hidden">
              {rest && <Key>Tab</Key>}
              <Key>↵</Key>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
