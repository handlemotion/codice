import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import {
  IconArrowUp,
  IconPlusSmall,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { memo, useEffect, useRef, useState, type FormEvent } from "react";
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
import { GHOST, ISLAND, Key } from "./components/ui";

// The dashboard's `POST /api/chat`, which calls the API's `POST /v1/chat` with the dashboard's key
// (src/routes/api/chat.ts). The answer streams back as AG-UI server-sent events.
const connection = fetchServerSentEvents("/api/chat");

// What an empty chat offers; a click sends one.
const SUGGESTIONS = [
  "¿Hasta cuándo puedo cancelar una factura?",
  "¿Qué significa el error CFDI40149?",
  "¿Qué uso de CFDI pongo en gastos médicos?",
  "¿Qué régimen fiscal es el 626?",
];

/** The API's limits: one question's length, and the messages a conversation may carry. */
const MAX_QUESTION_LENGTH = 2000;
const MAX_MESSAGES = 24;

// What Códice is doing while a tool runs, under its turning shapes (as on the site).
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

const FAILED = "No pude responder. Intenta de nuevo en un minuto.";

type ChatMessage = ReturnType<typeof useChat>["messages"][number];
type Part = ChatMessage["parts"][number];

function textOf(parts: readonly Part[]) {
  return parts.map((part) => (part.type === "text" ? part.content : "")).join("");
}

/** Códice's three shapes, turning while it works. */
function Working({ status }: { status: string | null }) {
  return (
    <span className="flex items-center gap-3">
      <span aria-hidden className="flex gap-1.5">
        {[0, 1, 2].map((step) => (
          <Mark className="size-3.5" key={step} step={step} strokeWidth={1.5} />
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

/** One answer, revealed at a steady pace; memoized so a token re-renders only the answer it extends. */
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
      {live && <Working status={status} />}
      {reveal.text && (
        <Streamdown className={ANSWER} isAnimating={reveal.revealing}>
          {reveal.text}
        </Streamdown>
      )}
      {failed && <p className="text-muted">{FAILED}</p>}
    </div>
  );
});

/**
 * The chat: a conversation with Códice in the page's column, the composer an island at its foot.
 * Nothing is stored; a new conversation starts clean.
 */
export function Chat() {
  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({ connection });
  const [query, setQuery] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const last = messages.at(-1);
  const pending = isLoading && last?.role === "user";
  const full = messages.length + 1 > MAX_MESSAGES;

  function send(text: string) {
    const question = text.trim();
    if (!question || isLoading || full) return;
    setQuery("");
    void sendMessage(question);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(query);
  }

  function restart() {
    stop();
    clear();
    setQuery("");
    input.current?.focus();
  }

  // `/` focuses the composer from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { target } = event;
      if (event.key !== "/" || (target instanceof Element && target.closest("input, textarea")))
        return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col gap-4 pt-6 pb-4 sm:h-svh sm:pt-10 sm:pb-6">
      <header className="flex h-8 shrink-0 items-center justify-between">
        <h1 className="text-[20px] leading-snug font-bold">Chat</h1>
        {messages.length > 0 && (
          <button className={`${GHOST} flex items-center gap-1`} onClick={restart} type="button">
            <IconPlusSmall size={16} />
            Nueva conversación
          </button>
        )}
      </header>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col justify-end gap-1 pb-4">
          {SUGGESTIONS.map((suggestion) => (
            <button
              className="w-fit py-1 text-left text-muted hover:text-fg"
              key={suggestion}
              onClick={() => send(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : (
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
                      <Answer
                        failed={Boolean(error) && !isLoading && index === messages.length - 1}
                        live={isLoading && index === messages.length - 1}
                        parts={message.parts}
                      />
                    )}
                  </MessageScrollerItem>
                ))}
                {pending && (
                  <MessageScrollerItem className="message-in" messageId="pending">
                    <Working status="Pensando" />
                  </MessageScrollerItem>
                )}
                {error && !isLoading && last?.role === "user" && (
                  <MessageScrollerItem messageId="error">
                    <p className="text-muted">{FAILED}</p>
                  </MessageScrollerItem>
                )}
                {full && (
                  <MessageScrollerItem messageId="full">
                    <p className="text-muted">
                      La conversación llegó a su límite. Empieza una nueva para seguir.
                    </p>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
          </MessageScroller>
        </MessageScrollerProvider>
      )}

      <form className={`${ISLAND} flex shrink-0 items-end gap-2 p-2 pl-3`} onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="ask">
          Pregúntale a Códice
        </label>
        <textarea
          autoFocus
          className="max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1 outline-none [field-sizing:content] placeholder:text-muted"
          disabled={full}
          enterKeyHint="send"
          id="ask"
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(query);
            }
          }}
          placeholder="Pregúntale a Códice"
          ref={input}
          rows={1}
          spellCheck={false}
          value={query}
        />
        <Key className="mb-1.5 text-muted max-sm:hidden">↵</Key>
        <button
          aria-label="Enviar"
          className="grid size-8 shrink-0 place-items-center rounded-[2px] bg-electric text-white hover:bg-fg hover:text-ink disabled:pointer-events-none disabled:opacity-50"
          disabled={!query.trim() || isLoading || full}
          type="submit"
        >
          <IconArrowUp size={16} />
        </button>
      </form>
    </div>
  );
}
