import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { IconArrowCornerDownLeft } from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
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
 * The chat of the first screen. The composer is the visitor's next bubble: grey, on the right,
 * under the title before any question and under the last answer after. Enter sends it where it
 * stands and Códice answers under it; the thread scrolls inside the first screen, faded at
 * whichever edge has more to read. Esc starts over.
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

  // While nothing is typed, the offered question changes every few seconds; it holds still while
  // the bubble has the keyboard, so the question there is the one Enter sends.
  useEffect(() => {
    if (query || isLoading) return;
    const timer = setInterval(() => {
      if (document.activeElement !== input.current) setRotation((count) => count + 1);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [query, isLoading]);

  // Once an answer is in, the next bubble takes the keyboard.
  useEffect(() => {
    if (open && !isLoading) input.current?.focus({ preventScroll: true });
  }, [open, isLoading]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = query.trim() || (ghost ?? "");
    if (!text || isLoading) return;
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
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      {/* Balanced, so its two lines run about the same length; the ground sits behind the lines only,
          so the field shows past where each line ends. */}
      <h1 className="text-[20px] leading-snug text-balance">
        <span className="box-decoration-clone bg-ink">
          Códice reúne la documentación fiscal de México para tus agentes. Conéctala a tu asistente
          o intégrala en tu producto.
        </span>
      </h1>

      <MessageScrollerProvider autoScroll scrollPreviousItemPeek={64}>
        <MessageScroller>
          <MessageScrollerViewport aria-label="Conversación con Códice" role="log">
            <MessageScrollerContent className="pb-6">
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
              {!isLoading && (
                <MessageScrollerItem messageId="composer">
                  <div className="flex flex-col items-end gap-2">
                    <Composer
                      input={input}
                      label={open ? "Pregunta algo más" : "Pregúntale a Códice"}
                      onSubmit={onSubmit}
                      query={query}
                      rest={rest}
                      setQuery={setQuery}
                    />
                    {/* Under the bubble, in small raw text: how to send it, and how to start over. */}
                    <div className="flex items-center gap-4 bg-ink text-[13px] text-muted">
                      {open && (
                        <button className="hover:text-fg" onClick={reset} type="button">
                          Empezar de nuevo
                        </button>
                      )}
                      <span className="flex items-center gap-1.5">
                        <IconArrowCornerDownLeft size={14} />
                        Enviar
                      </span>
                    </div>
                  </div>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
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
  // visitor types it follows at once.
  const sizer = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (sizer.current) setWidth(Math.ceil(sizer.current.getBoundingClientRect().width));
  }, [query, rest]);

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
