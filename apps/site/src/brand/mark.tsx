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
  lag = 0,
}: {
  className?: string;
  strokeWidth?: number;
  animate?: boolean;
  /** The shape's radius in the 24-unit box; 8 leaves a margin, 10 nearly fills it. */
  radius?: number;
  /** Shapes ahead of the shared clock, so marks side by side show different shapes. */
  step?: number;
  /** Milliseconds behind the shared clock, so a row of marks rolls like the field's wave. */
  lag?: number;
}) {
  const path = useRef<SVGPathElement>(null);
  const offset = step * STEP_MS - lag;
  useMarkClock(
    (elapsed) =>
      path.current?.setAttribute("d", markPath(Math.max(0, elapsed + offset), 12, 12, radius)),
    animate,
  );

  return (
    <svg aria-hidden className={className} fill="none" viewBox="0 0 24 24">
      <path
        d={markPath(Math.max(0, offset), 12, 12, radius)}
        ref={path}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const FIELD_CELL = 180; // px per mark in the field, roughly: the cells stretch to fit whole rows
export const WAVE_MS = 120; // each diagonal runs this far behind the one above-left of it
// The radius as a share of the cell. At 0.45 a triangle is 0.95 of the cell wide, so neighbouring
// triangles keep a small gap; circles and squares sit a little smaller inside their cells.
const FIELD_RADIUS = 0.45;

/**
 * A field of marks filling its box: whole columns and rows of cells, about 180px each, stretched a
 * little to fill it exactly, so nothing is cropped and the edges match the gaps. Every mark is on the shared clock, each diagonal a little behind the last,
 * so the morph rolls from the top-left corner to the bottom-right like a wave. One SVG and one
 * clock for the whole field.
 */
export function MarkField({ className }: { className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const grid = useRef({ cols: 0, width: 0, height: 0 });

  // Rebuilds the grid of paths whenever the box changes size.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const layout = () => {
      const { width, height } = element.getBoundingClientRect();
      // Whole columns and rows that fill the box exactly; cells stretch a little to fit, so the
      // space at the edges is the same as between marks.
      const rows = Math.max(1, Math.round(height / FIELD_CELL));
      const cols = Math.max(1, Math.round(width / FIELD_CELL));
      grid.current = { cols, width: width / cols, height: height / rows };
      element.setAttribute("viewBox", `0 0 ${width} ${height}`);
      element.replaceChildren(
        ...Array.from({ length: cols * rows }, () =>
          document.createElementNS("http://www.w3.org/2000/svg", "path"),
        ),
      );
      draw(restingAt(performance.now()));
    };
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function draw(elapsed: number) {
    const element = svg.current;
    if (!element) return;
    const { cols, width, height } = grid.current;
    const radius = Math.min(width, height) * FIELD_RADIUS;
    Array.from(element.children).forEach((path, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const lag = (col + row) * WAVE_MS;
      const cx = col * width + width / 2;
      const cy = row * height + height / 2;
      path.setAttribute("d", markPath(Math.max(0, elapsed - lag), cx, cy, radius));
    });
  }

  useMarkClock(draw);

  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      preserveAspectRatio="none"
      ref={svg}
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth={1}
    />
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
