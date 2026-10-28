import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Composer } from "./composer";

/**
 * The first screen's ask box: the hero title and the composer. A question opens the chat page
 * (`/chat`), which asks it; it travels in the history entry's state, never in the URL.
 */
export function Ask() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);

  // `/` anywhere focuses the composer; Esc leaves it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement;
      if (event.key === "/" && !typing) {
        event.preventDefault();
        input.current?.focus();
        input.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (event.key === "Escape") {
        input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="self-start bg-ink text-[20px] leading-snug text-balance">
        Códice es el primer índice de documentación legal mexicana.
      </h1>
      <Composer
        inputRef={input}
        onSend={(question) => void navigate({ to: "/chat", state: { question } })}
      />
    </div>
  );
}
