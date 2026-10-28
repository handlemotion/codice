// Transitive's `useStreamedReveal` (apps/transitive agent-streamed-reveal.ts), for one text: a
// live answer shows at a steady pace instead of in the model's bursts, and drains a burst within
// a second rather than trailing the stream.
import { useEffect, useRef, useState } from "react";

// aicss streaming-text: two characters every 9ms.
const REVEAL_CHARS = 2;
const REVEAL_INTERVAL_MS = 9;
const REVEAL_CATCH_UP_MS = 1_000;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The part of `text` to show now, and whether it is still arriving or catching up. */
export function useStreamedReveal(text: string, live: boolean) {
  const [revealed, setRevealed] = useState(() => (live ? 0 : text.length));
  const lengthRef = useRef(text.length);
  lengthRef.current = text.length;
  const behind = revealed < text.length;

  useEffect(() => {
    if (!behind) return;
    if (prefersReducedMotion()) {
      setRevealed(lengthRef.current);
      return;
    }
    const interval = window.setInterval(() => {
      setRevealed((current) => {
        const backlog = lengthRef.current - current;
        if (backlog <= 0) return current;
        const step = Math.max(
          REVEAL_CHARS,
          Math.ceil((backlog * REVEAL_INTERVAL_MS) / REVEAL_CATCH_UP_MS),
        );
        return Math.min(lengthRef.current, current + step);
      });
    }, REVEAL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [behind]);

  return { text: behind ? text.slice(0, revealed) : text, revealing: live || behind };
}
