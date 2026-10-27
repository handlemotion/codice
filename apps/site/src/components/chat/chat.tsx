// Chat primitives adapted from Transitive's `@transitive/ui` (`chat-composer`, `chat-markdown`,
// `chat-empty-state`, `chat-error`, `chat-thinking`, `message`), restyled to the site's stone palette
// and without its design-system dependencies.
import { useEffect, useRef, type ComponentProps, type FormEvent, type KeyboardEvent } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const markdownClassName =
  "text-sm leading-relaxed text-stone-800 [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:text-stone-600 [&_li]:my-0.5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_[data-streamdown=inline-code]]:rounded-sm [&_[data-streamdown=inline-code]]:bg-stone-100 [&_[data-streamdown=inline-code]]:px-1 [&_[data-streamdown=inline-code]]:py-0.5 [&_[data-streamdown=inline-code]]:font-mono [&_[data-streamdown=inline-code]]:text-[0.8125rem]";

export function ChatMarkdown({ children, streaming }: { children: string; streaming: boolean }) {
  return (
    <Streamdown className={markdownClassName} isAnimating={streaming}>
      {children}
    </Streamdown>
  );
}

export function Message({
  align,
  children,
}: {
  align: "start" | "end";
  children: ComponentProps<"div">["children"];
}) {
  return (
    <div className={cx("flex w-full min-w-0", align === "end" && "justify-end")}>
      <div
        className={cx(
          "min-w-0 wrap-break-word",
          align === "end"
            ? "max-w-[85%] rounded-lg bg-stone-900 px-3 py-2 text-sm whitespace-pre-wrap text-white"
            : "w-full",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** A spinner and a label, for the steps the assistant takes before it answers. */
export function ChatActivity({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-stone-500" role="status">
      <span
        aria-hidden="true"
        className={cx(
          "size-3 shrink-0 rounded-full border border-stone-300 border-t-stone-600",
          active && "animate-spin",
        )}
      />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}

export function ChatSuggestions({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: readonly string[];
  onPick: (suggestion: string) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="sr-only">Preguntas sugeridas</legend>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-left text-sm transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            key={suggestion}
            onClick={() => onPick(suggestion)}
            type="button"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function ChatError({ children }: { children: string }) {
  return (
    <p className="px-4 pb-2 text-sm text-red-700" role="alert">
      {children}
    </p>
  );
}

/** Keeps the newest message in view while the answer streams in. */
export function ChatScroller({
  children,
  follow,
}: {
  children: ComponentProps<"div">["children"];
  follow: unknown;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [follow]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" ref={viewport}>
      <div className="flex flex-col gap-5">{children}</div>
    </div>
  );
}

export function ChatComposer({
  draft,
  onDraftChange,
  onSubmit,
  disabled,
  canStop,
  onStop,
  placeholder,
  maxLength,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
  canStop: boolean;
  onStop: () => void;
  placeholder: string;
  maxLength: number;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };
  const canSubmit = draft.trim().length > 0 && !disabled;
  return (
    <form className="shrink-0 px-4 pb-4" onSubmit={onSubmit}>
      <div className="flex items-end gap-1 rounded-lg border border-stone-300 bg-white p-1 focus-within:border-stone-500">
        <textarea
          aria-label="Pregunta"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-stone-400"
          disabled={disabled}
          maxLength={maxLength}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          value={draft}
        />
        {canStop ? (
          <button
            aria-label="Detener"
            className="flex size-8 items-center justify-center rounded-md bg-stone-200 text-stone-900 hover:bg-stone-300"
            onClick={onStop}
            type="button"
          >
            <span className="size-2.5 rounded-sm bg-current" />
          </button>
        ) : (
          <button
            aria-label="Enviar"
            className="flex size-8 items-center justify-center rounded-md bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-40"
            disabled={!canSubmit}
            type="submit"
          >
            <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
              <path
                d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
