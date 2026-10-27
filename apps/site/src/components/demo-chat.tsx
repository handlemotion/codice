import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useState, type FormEvent } from "react";

import {
  ChatActivity,
  ChatComposer,
  ChatError,
  ChatMarkdown,
  ChatScroller,
  ChatSuggestions,
  Message,
} from "./chat/chat";

// The site's own `POST /_site/chat`, which calls the API's `POST /v1/chat` with the site's key.
const connection = fetchServerSentEvents("/_site/chat");

const SUGGESTIONS = [
  "¿Qué significa el error CFDI40149?",
  "¿Qué es el uso de CFDI S01?",
  "¿Cuándo se emite un complemento de pagos?",
] as const;

const TOOL_LABELS: Record<string, string> = {
  search: "Buscando en las reglas del SAT",
  read_passage: "Leyendo el pasaje",
  lookup_error: "Consultando la matriz de errores",
  lookup_catalog: "Consultando el catálogo",
  list_sources: "Revisando las fuentes",
};

/** Matches the API's limit on one question (`CHAT_MAX_BODY_BYTES` bounds the whole conversation). */
const MAX_QUESTION_LENGTH = 2000;

export function DemoChat() {
  const { messages, sendMessage, isLoading, error, stop } = useChat({ connection });
  const [draft, setDraft] = useState("");

  const send = (text: string) => {
    const question = text.trim();
    if (!question || isLoading) return;
    setDraft("");
    void sendMessage(question);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send(draft);
  };

  const last = messages.at(-1);
  const waiting = isLoading && last?.role === "user";

  return (
    <section
      aria-label="Pregúntale a Códice"
      className="flex h-[32rem] flex-col overflow-hidden rounded-lg border border-stone-200 bg-stone-50"
    >
      <header className="border-b border-stone-200 px-4 py-3">
        <p className="text-sm font-medium">Pregúntale a Códice</p>
        <p className="text-xs text-stone-500">
          Responde con las reglas del SAT, citadas con su fuente. No es asesoría fiscal.
        </p>
      </header>
      <ChatScroller follow={messages}>
        {messages.length === 0 ? (
          <ChatSuggestions disabled={isLoading} onPick={send} suggestions={SUGGESTIONS} />
        ) : null}
        {messages.map((message, index) => {
          const streaming = isLoading && index === messages.length - 1;
          if (message.role === "user") {
            const text = message.parts
              .map((part) => (part.type === "text" ? part.content : ""))
              .join("");
            return (
              <Message align="end" key={message.id}>
                {text}
              </Message>
            );
          }
          return (
            <Message align="start" key={message.id}>
              <div className="flex flex-col gap-2">
                {message.parts.map((part, partIndex) => {
                  if (part.type === "tool-call") {
                    // A server tool's result arrives as a later part; the call is done once any follows.
                    const done =
                      partIndex < message.parts.length - 1 ||
                      part.state === "complete" ||
                      part.state === "error";
                    return (
                      <ChatActivity
                        active={streaming && !done}
                        key={part.id}
                        label={TOOL_LABELS[part.name] ?? "Consultando"}
                      />
                    );
                  }
                  if (part.type === "text" && part.content) {
                    return (
                      <ChatMarkdown key={`${message.id}-${partIndex}`} streaming={streaming}>
                        {part.content}
                      </ChatMarkdown>
                    );
                  }
                  return null;
                })}
              </div>
            </Message>
          );
        })}
        {waiting ? <ChatActivity active label="Pensando" /> : null}
      </ChatScroller>
      {error ? <ChatError>No pude responder. Intenta de nuevo en un minuto.</ChatError> : null}
      <ChatComposer
        canStop={isLoading}
        disabled={false}
        draft={draft}
        maxLength={MAX_QUESTION_LENGTH}
        onDraftChange={setDraft}
        onStop={stop}
        onSubmit={onSubmit}
        placeholder="Pregunta sobre CFDI 4.0, catálogos o errores del SAT"
      />
    </section>
  );
}
