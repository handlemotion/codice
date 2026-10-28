import { useEffect, useState, type ReactNode, type Ref } from "react";

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

// Key caps live only on the inverted composer (`bg-fg`), so they use the ground's ink.
export function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[2px] border border-ink/25 px-1.5 py-1 text-[11px] text-ink/60">
      {children}
    </kbd>
  );
}

/**
 * The inverted box a question is typed in. It offers questions as ghost text (rotating while it is
 * empty, completing while typing) that Tab takes; Enter sends only what is typed. `action`
 * replaces the key caps at the right, for a control such as "Detener".
 */
export function Composer({
  onSend,
  disabled = false,
  suggest = true,
  action,
  inputRef,
  autoFocus,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Offer questions as ghost text; off once a conversation has its own direction. */
  suggest?: boolean;
  action?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [rotation, setRotation] = useState(0);
  const ghost = suggest && !disabled ? completion(query, rotation) : null;
  const rest = ghost?.slice(query.length) ?? "";

  // While nothing is typed, the offered question changes every few seconds.
  useEffect(() => {
    if (query || !suggest) return;
    const timer = setInterval(() => setRotation((count) => count + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [query, suggest]);

  return (
    <form
      className="rounded-[4px] bg-fg text-ink"
      onSubmit={(event) => {
        event.preventDefault();
        // Only what is typed is sent: an offered question is taken with Tab first.
        const text = query.trim();
        if (!text || disabled) return;
        setQuery("");
        onSend(text);
      }}
      role="search"
    >
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
          autoFocus={autoFocus}
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
          ref={inputRef}
          spellCheck={false}
          value={query}
        />
        {action ?? (
          <span className="flex gap-1.5 max-sm:hidden">
            {rest && <Key>Tab</Key>}
            {query.trim() && !disabled && <Key>↵</Key>}
          </span>
        )}
      </div>
    </form>
  );
}
