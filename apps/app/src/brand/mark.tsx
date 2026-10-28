// Copied from apps/site/src/brand/mark.tsx (the field left out): keep the two in step.
import { useEffect, useRef } from "react";

import { currentTheme } from "../theme";
import { faviconSvg, markPath, restingAt, STEP_MS } from "./shapes";

const FRAME_MS = 1000 / 12;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Runs `frame` at 12fps on a clock shared by every mark on the page and the favicon, so they
 * move in step, while `running`. Stops on reduced motion, and parks on a whole shape when it
 * stops or the tab is hidden (a frozen mid-morph would look broken).
 */
function useMarkClock(frame: (elapsed: number) => void, running = true) {
  const frameRef = useRef(frame);
  frameRef.current = frame;

  useEffect(() => {
    if (!running || reducedMotion()) return;
    let request = 0;
    let shown = -1;
    const tick = (now: number) => {
      // Posterized: the mark steps at 12fps like hand-drawn animation, on a clock shared by all.
      const frame = Math.floor(now / FRAME_MS);
      if (frame !== shown) frameRef.current((shown = frame) * FRAME_MS);
      request = requestAnimationFrame(tick);
    };
    const onVisibility = () => {
      cancelAnimationFrame(request);
      if (document.hidden) frameRef.current(restingAt(performance.now()));
      else request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(request);
      document.removeEventListener("visibilitychange", onVisibility);
      frameRef.current(restingAt(performance.now()));
    };
  }, [running]);
}

/**
 * The Códice mark, one stroked line morphing between circle, square and triangle. With
 * `animate` false it rests on a whole shape.
 */
export function Mark({
  className,
  strokeWidth = 1.5,
  animate = true,
  radius = 8,
  step = 0,
}: {
  className?: string;
  strokeWidth?: number;
  animate?: boolean;
  /** The shape's radius in the 24-unit box; 8 leaves a margin, 10 nearly fills it. */
  radius?: number;
  /** Shapes ahead of the shared clock, so marks side by side show different shapes. */
  step?: number;
}) {
  const path = useRef<SVGPathElement>(null);
  const offset = step * STEP_MS;
  useMarkClock(
    (elapsed) => path.current?.setAttribute("d", markPath(elapsed + offset, 12, 12, radius)),
    animate,
  );

  return (
    <svg aria-hidden className={className} fill="none" viewBox="0 0 24 24">
      <path
        d={markPath(offset, 12, 12, radius)}
        ref={path}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Animates the `link[rel=icon]` the root route renders, in step with every `Mark` and in the page's theme. */
export function useAnimatedFavicon() {
  useMarkClock((elapsed) => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
    if (icon)
      icon.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(elapsed, currentTheme()))}`;
  });
}
