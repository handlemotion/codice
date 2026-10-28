import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Streamdown } from "streamdown";

import { Mark, WAVE_MS } from "./brand/mark";
import { Composer, Key } from "./composer";

// The site's own `POST /_site/chat`, which calls the API's `POST /v1/chat` with the site's key
// (src/routes/[_site]/chat.ts). The answer streams back as AG-UI server-sent events.
const connection = fetchServerSentEvents("/_site/chat");

/** The API refuses a conversation of more than 24 messages (`apps/api/SPEC.md`, "Chat"). */
const MAX_MESSAGES = 24;

// What Códice is doing while a tool runs, beside its rolling shapes.
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

type Message = ReturnType<typeof useChat>["messages"][number];

function text(message: Message) {
  return message.parts.map((part) => (part.type === "text" ? part.content : "")).join("");
}

// What Códice is doing now: the tool it is running (a call with no part after it yet), or
// thinking until the answer starts.
function statusOf(message: Message | undefined) {
  const tail = message?.parts.at(-1);
  if (tail?.type === "tool-call" && tail.state !== "complete" && tail.state !== "error") {
    return TOOL_LABELS[tail.name] ?? "Consultando";
  }
  return message && text(message) ? null : "Pensando";
}

/**
 * The full-screen chat: a conversation with Códice, the composer pinned to the bottom. A question
 * asked on the first screen arrives in the history entry's state and is asked on arrival.
 */
export function Chat() {
  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({ connection });
  const navigate = useNavigate();
  const handed = useLocation({ select: (location) => location.state.question });
  const input = useRef<HTMLInputElement>(null);
  const pinned = useRef(true);
  const full = messages.length + 1 > MAX_MESSAGES;

  // The first screen's question, asked once; the entry's state is then cleared so a reload or a
  // return through history does not ask it again. Deferred and cancelled on cleanup, so a mount
  // that is torn down at once (React's development double mount) neither asks nor aborts it.
  useEffect(() => {
    if (!handed) return;
    const timer = setTimeout(() => {
      void sendMessage(handed);
      void navigate({ to: "/chat", replace: true, state: {} });
    });
    return () => clearTimeout(timer);
  }, [handed, navigate, sendMessage]);

  // The page keeps to the end of the conversation while it grows, unless the visitor scrolled up.
  useEffect(() => {
    const onScroll = () => {
      const page = document.documentElement;
      pinned.current = page.scrollHeight - window.scrollY - window.innerHeight < 48;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (pinned.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages]);

  // `/` anywhere focuses the composer; Esc stops an answer on its way.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
      } else if (event.key === "Escape" && isLoading) {
        stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isLoading, stop]);

  function restart() {
    stop();
    clear();
    input.current?.focus();
  }

  const last = messages.at(-1);
  const answering = isLoading ? (last?.role === "assistant" ? last : undefined) : undefined;
  const status = isLoading ? statusOf(answering) : null;

  return (
    <div className="flex min-h-dvh flex-col text-[14px] leading-[1.7]">
      <header className="sticky top-0 z-10 flex h-[44px] items-center justify-between border-b border-line bg-ink px-4 sm:h-[52px]">
        <Link className="flex items-center gap-2 hover:underline" to="/">
          <Mark animate={false} className="size-5" radius={10} strokeWidth={1} />
          Códice
        </Link>
        {messages.length > 0 && (
          <button
            className="inline-flex h-7 items-center rounded-[2px] border border-line bg-ink px-2 text-[13px] hover:border-fg"
            onClick={restart}
            type="button"
          >
            Nueva conversación
          </button>
        )}
      </header>

      <ol
        aria-live="polite"
        className="mx-auto flex w-full max-w-[34rem] flex-1 flex-col gap-6 px-4 pt-8 pb-6"
      >
        {messages.length === 0 && !isLoading && (
          <li className="m-auto flex flex-col items-center gap-4 text-muted">
            <Marks animate />
            Pregúntale a Códice por una regla del SAT.
          </li>
        )}
        {messages.map((message) =>
          message.role === "user" ? (
            <li
              className="max-w-[80%] self-end rounded-[4px] bg-electric px-3 py-2 text-white"
              key={message.id}
            >
              {text(message)}
            </li>
          ) : (
            <li className="flex flex-col gap-3" key={message.id}>
              {message === answering && <Status status={status} />}
              {text(message) && (
                <Streamdown className={ANSWER} isAnimating={message === answering}>
                  {text(message)}
                </Streamdown>
              )}
            </li>
          ),
        )}
        {isLoading && !answering && (
          <li>
            <Status status={status} />
          </li>
        )}
        {error && !isLoading && (
          <li className="text-muted">No pude responder. Intenta de nuevo en un minuto.</li>
        )}
        {full && (
          <li className="text-muted">
            Esta conversación llegó a su límite. Empieza una nueva para seguir preguntando.
          </li>
        )}
      </ol>

      <div className="sticky bottom-0 bg-ink">
        <div className="mx-auto w-full max-w-[34rem] px-4 pt-2 pb-6 sm:pb-8">
          <Composer
            action={
              isLoading ? (
                <button
                  className="flex items-center gap-2 text-ink/60 hover:text-ink"
                  onClick={stop}
                  type="button"
                >
                  <Key>Esc</Key>
                  Detener
                </button>
              ) : undefined
            }
            autoFocus
            disabled={isLoading || full}
            inputRef={input}
            onSend={(question) => {
              pinned.current = true;
              void sendMessage(question);
            }}
            suggest={messages.length === 0}
          />
        </div>
      </div>
    </div>
  );
}

function Status({ status }: { status: string | null }) {
  return (
    <span className="flex items-center gap-3">
      <Marks animate />
      {status && (
        <span className="text-muted" role="status">
          {status}
        </span>
      )}
    </span>
  );
}
