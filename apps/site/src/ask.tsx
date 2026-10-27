import type { ApiSuccessEnvelope } from "@codice/contracts";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Mark } from "./brand/mark";

// The `POST /v1/answer` contract. Move these to `@codice/contracts` once the API defines them there.
type Citation = {
  passageId: string;
  title: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  validFrom: string | null;
};
type Answer = { answer: string; citations: readonly Citation[] };

type State =
  | { status: "idle" }
  | { status: "asking"; question: string }
  | { status: "answered"; question: string; answer: Answer }
  | { status: "failed"; question: string; message: string };

const BEAT_MS = 1000 / 12; // The answer writes itself on the same 12fps beat as the mark.
const CHARS_PER_BEAT = 3;

// `/v1` is on the same host: the edge sends it to the API Worker (Vite proxies it in development).
// One question, one answer: v1 sends no history.
async function ask(question: string, signal: AbortSignal): Promise<Answer> {
  const response = await fetch("/v1/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
    signal,
  });
  // Problem titles are the API's English; the visitor reads Spanish.
  if (response.status === 429) throw new Error("Demasiadas preguntas. Espera un minuto.");
  if (response.status === 404) throw new Error("Códice todavía no responde preguntas aquí.");
  if (response.status === 400)
    throw new Error("No entendí la pregunta. Intenta escribirla de otra forma.");
  if (!response.ok) throw new Error("Códice no respondió. Intenta de nuevo.");
  return ((await response.json()) as ApiSuccessEnvelope<Answer>).data;
}

// How many characters of `text` are written so far: a few per beat, or all at once when the
// visitor asks for less motion.
function useTypedLength(text: string) {
  const [length, setLength] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLength(text.length);
      return;
    }
    setLength(0);
    const timer = setInterval(() => {
      setLength((count) => Math.min(count + CHARS_PER_BEAT, text.length));
    }, BEAT_MS);
    return () => clearInterval(timer);
  }, [text]);
  return length;
}

// Questions the composer offers as ghost text: Tab takes one, Enter on an empty composer sends it.
const SUGGESTIONS = [
  "¿Hasta cuándo puedo cancelar un CFDI?",
  "¿Qué significa el error CFDI40149?",
  "¿Para qué es el uso de CFDI G03?",
  "¿Qué pide la regla 2.7.1.34 de la RMF?",
];
const ROTATE_MS = 4000;

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

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-line px-1.5 text-[11px] text-muted">{children}</kbd>
  );
}

/**
 * The chat on the right of the first screen: Códice greets, the visitor asks one question (a
 * blue bubble), and Códice answers while its three shapes turn. The composer offers questions.
 */
export function Ask() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const [rotation, setRotation] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const open = state.status !== "idle";
  const ghost = open ? null : completion(query, rotation);
  const rest = ghost?.slice(query.length) ?? "";

  // While nothing is typed, the offered question changes every few seconds.
  useEffect(() => {
    if (open || query) return;
    const timer = setInterval(() => setRotation((count) => count + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [open, query]);

  async function send(question: string) {
    if (!question || open) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "asking", question });
    try {
      const answer = await ask(question, controller.signal);
      setState({ status: "answered", question, answer });
    } catch (error) {
      if (controller.signal.aborted) return;
      setState({ status: "failed", question, message: (error as Error).message });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void send(query.trim() || (ghost ?? ""));
  }

  function reset() {
    request.current?.abort();
    setState({ status: "idle" });
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

  return (
    <div className="flex flex-col gap-6">
      <ol aria-live="polite" className="flex flex-col gap-6">
        <li className="flex items-center gap-3 self-center bg-ink">
          <Mark animate={false} className="size-3.5 shrink-0" strokeWidth={1.5} />
          <p>Pregúntame por cualquier regla del SAT.</p>
        </li>
        {open && (
          <li className="max-w-[80%] self-end rounded-[4px] bg-electric px-3 py-2 text-white">
            {state.question}
          </li>
        )}
        {open && (
          <li>
            <AgentTurn state={state} />
          </li>
        )}
      </ol>

      <form className="rounded-[4px] border border-line bg-ink" onSubmit={onSubmit} role="search">
        <label className="sr-only" htmlFor="ask">
          Pregúntale a Códice
        </label>
        <div className="relative flex items-center gap-3 px-3 py-2">
          {/* The ghost: what is typed, invisible, then the rest of the offered question. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-2 left-3 right-24 overflow-hidden whitespace-pre"
          >
            <span className="invisible">{query}</span>
            <span className="text-muted">{rest}</span>
          </div>
          <input
            autoComplete="off"
            className="relative min-w-0 flex-1 bg-transparent caret-fg outline-none read-only:cursor-default"
            enterKeyHint="send"
            id="ask"
            maxLength={500}
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
              className="flex items-center gap-2 text-muted hover:text-fg"
              onClick={reset}
              type="button"
            >
              <Key>Esc</Key>
              Otra pregunta
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

// Códice's side of the chat: its three shapes turn while it reads and while the answer writes
// itself, then rest beside the finished answer and its sources.
function AgentTurn({ state }: { state: Exclude<State, { status: "idle" }> }) {
  const text = state.status === "answered" ? state.answer.answer : "";
  const length = useTypedLength(text);
  const working =
    state.status === "asking" || (state.status === "answered" && length < text.length);
  return (
    <div className="flex flex-col gap-3">
      <span aria-label={working ? "Códice está respondiendo" : undefined} className="flex gap-1.5">
        {[0, 1, 2].map((step) => (
          <Mark animate={working} className="size-3.5" key={step} step={step} strokeWidth={1.5} />
        ))}
      </span>
      {state.status === "failed" && <p className="text-muted">{state.message}</p>}
      {state.status === "answered" && (
        <>
          <p className="whitespace-pre-line">{text.slice(0, length)}</p>
          {!working && state.answer.citations.length > 0 && (
            <ol className="flex flex-col text-muted">
              {state.answer.citations.map((citation, index) => {
                const label = citation.title ?? citation.sourceTitle ?? citation.passageId;
                return (
                  <li key={citation.passageId}>
                    {index + 1}.{" "}
                    {citation.sourceUrl ? (
                      <a
                        className="underline hover:text-fg"
                        href={citation.sourceUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                    {citation.validFrom && `, vigente desde ${citation.validFrom}`}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
