import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Streamdown } from "streamdown";

import { Mark } from "./brand/mark";

// The site's own `POST /_site/chat`, which calls the API's `POST /v1/chat` with the site's key
// (src/routes/[_site]/chat.ts). The answer streams back as AG-UI server-sent events.
const connection = fetchServerSentEvents("/_site/chat");

// Questions the composer offers as ghost text: Tab takes one, Enter on an empty composer sends it.
const SUGGESTIONS = [
  "¿Hasta cuándo puedo cancelar un CFDI?",
  "¿Qué significa el error CFDI40149?",
  "¿Para qué es el uso de CFDI G03?",
  "¿Qué pide la regla 2.7.1.34 de la RMF?",
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

// Key caps live only inside the composer, which is inverted (`bg-fg`), so they use the ground's ink.
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-ink/25 px-1.5 py-1 text-[11px] text-ink/60">
      {children}
    </kbd>
  );
}

/**
 * The chat of the first screen: Códice greets, the visitor asks one question (a blue bubble), and
 * Códice answers while its three shapes turn. The composer offers questions. One question, one
 * answer: Esc clears it for the next.
 */
export function Ask() {
  const { messages, sendMessage, isLoading, error, stop, clear } = useChat({ connection });
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const open = messages.length > 0 || isLoading;
  const ghost = open ? null : completion(query, rotation);
  const rest = ghost?.slice(query.length) ?? "";

  const question = messages
    .find((message) => message.role === "user")
    ?.parts.map((part) => (part.type === "text" ? part.content : ""))
    .join("");
  // One question, one answer: the reply is the last message once Códice starts answering.
  const last = messages.at(-1);
  const reply = last?.role === "assistant" ? last : undefined;

  // While nothing is typed, the offered question changes every few seconds.
  useEffect(() => {
    if (open || query) return;
    const timer = setInterval(() => setRotation((count) => count + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [open, query]);

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
      if (event.key === "/" && !typing && !open) {
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
      <ol aria-live="polite" className="flex flex-col gap-6 empty:hidden">
        {question && (
          <li className="max-w-[80%] self-end rounded-[4px] bg-electric px-3 py-2 text-white">
            {question}
          </li>
        )}
        {open && (
          <li className="flex flex-col gap-3 bg-ink">
            <span className="flex items-center gap-3">
              <span aria-hidden className="flex gap-1.5">
                {[0, 1, 2].map((step) => (
                  <Mark
                    animate={isLoading}
                    className="size-3.5"
                    key={step}
                    step={step}
                    strokeWidth={1.5}
                  />
                ))}
              </span>
              {status && (
                <span className="text-muted" role="status">
                  {status}
                </span>
              )}
            </span>
            {answer && (
              <Streamdown className={ANSWER} isAnimating={isLoading}>
                {answer}
              </Streamdown>
            )}
            {error && !isLoading && (
              <p className="text-muted">No pude responder. Intenta de nuevo en un minuto.</p>
            )}
          </li>
        )}
      </ol>

      <form className="rounded-[4px] bg-fg text-ink" onSubmit={onSubmit} role="search">
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
            className="relative min-w-0 flex-1 bg-transparent caret-ink outline-none read-only:cursor-default"
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
            readOnly={open}
            ref={input}
            spellCheck={false}
            value={open ? "" : query}
          />
          {open ? (
            <button
              className="flex items-center gap-2 text-ink/60 hover:text-ink"
              onClick={reset}
              type="button"
            >
              <Key>Esc</Key>
              {isLoading ? "Detener" : "Otra pregunta"}
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
