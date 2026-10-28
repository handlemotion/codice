// The brand mark: one closed line that morphs circle → square → triangle, turning a quarter turn
// clockwise on each step and resting upright on every shape. Each shape is sampled as the same
// number of points by angle from the center, so a morph is a point-by-point interpolation.

const SAMPLES = 120; // A multiple of 3 and 4: the square's and triangle's corners land on samples.
const TURN = Math.PI / 2;

export const HOLD_MS = 1100;
export const MORPH_MS = 900;
export const STEP_MS = HOLD_MS + MORPH_MS;

type Point = readonly [number, number];
type Shape = readonly Point[];

// Radius at angle `theta` (y down, 0 = right) of a regular polygon with one vertex at `vertex`.
function polygonRadius(sides: number, circumradius: number, vertex: number, theta: number) {
  const sector = (2 * Math.PI) / sides;
  const offset = (((theta - vertex) % sector) + sector) % sector;
  return (circumradius * Math.cos(Math.PI / sides)) / Math.cos(offset - Math.PI / sides);
}

// Unit-radius shapes, optically balanced: the square is drawn smaller than the circle it replaces
// and the triangle larger, centered on its height rather than its centroid.
function sample(radius: (theta: number) => number, dy = 0): Shape {
  return Array.from({ length: SAMPLES }, (_, index) => {
    const theta = -Math.PI / 2 + (index / SAMPLES) * 2 * Math.PI;
    const r = radius(theta);
    return [r * Math.cos(theta), r * Math.sin(theta) + dy] as const;
  });
}

const CIRCLE = sample(() => 1);
const SQUARE = sample((theta) => polygonRadius(4, 0.86 * Math.SQRT2, Math.PI / 4, theta));
const TRIANGLE = sample((theta) => polygonRadius(3, 1.22, -Math.PI / 2, theta), 0.3);
const SHAPES = [CIRCLE, SQUARE, TRIANGLE];

function rotate([x, y]: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [x * cos - y * sin, x * sin + y * cos];
}

// CSS-style cubic-bezier(x1, y1, x2, y2), solved for x by Newton's method then bisection.
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  const slope = (a: number, b: number, t: number) =>
    3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t ** 2;
  return (x: number) => {
    if (x <= 0 || x >= 1) return Math.min(Math.max(x, 0), 1);
    let t = x;
    for (let index = 0; index < 8; index += 1) {
      const error = curve(x1, x2, t) - x;
      if (Math.abs(error) < 1e-6) return curve(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let low = 0;
    let high = 1;
    t = x;
    while (high - low > 1e-6) {
      if (curve(x1, x2, t) < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return curve(y1, y2, t);
  };
}

// The outline moves on a strong ease-in-out; the turn uses a slower start and a small overshoot,
// so the shape settles into place instead of stopping dead.
const easeMorph = cubicBezier(0.76, 0, 0.24, 1);
const easeTurn = cubicBezier(0.6, 0, 0.2, 1.18);

/** The mark at `elapsed` ms, as points scaled to `radius` around (`cx`, `cy`). */
export function markPoints(elapsed: number, cx: number, cy: number, radius: number): Point[] {
  const step = Math.floor(elapsed / STEP_MS);
  const into = elapsed - step * STEP_MS;
  const from = SHAPES[step % SHAPES.length]!;
  const to = SHAPES[(step + 1) % SHAPES.length]!;
  const progress = into <= HOLD_MS ? 0 : (into - HOLD_MS) / MORPH_MS;
  const morph = easeMorph(progress);
  const turn = easeTurn(progress) * TURN;
  return from.map((source, index) => {
    // The target starts a quarter turn back, so it lands upright once the turn completes. Pair
    // points at the same angle (a quarter of the samples on), or the line cuts across the center.
    const target = rotate(to[(index + SAMPLES / 4) % SAMPLES]!, -TURN);
    const point = rotate(
      [source[0] + (target[0] - source[0]) * morph, source[1] + (target[1] - source[1]) * morph],
      turn,
    );
    return [cx + point[0] * radius, cy + point[1] * radius];
  });
}

/** An SVG path `d` for the mark at `elapsed` ms. */
export function markPath(elapsed: number, cx: number, cy: number, radius: number): string {
  const points = markPoints(elapsed, cx, cy, radius);
  return `M${points.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z`;
}

/** The start of the hold on the shape the mark is on or heading to, for a clean pause. */
export function restingAt(elapsed: number): number {
  const step = Math.floor(elapsed / STEP_MS);
  return elapsed - step * STEP_MS <= HOLD_MS ? step * STEP_MS : (step + 1) * STEP_MS;
}

// Dark keeps the original tile: near-black with an off-white line. Light turns it electric blue.
const TILE = {
  dark: { fill: "#0a0a0b", stroke: "#f4f4f5" },
  light: { fill: "#2346ff", stroke: "#ffffff" },
} as const;

/** The favicon at `elapsed` ms, in the page's theme. */
export function faviconSvg(elapsed: number, theme: keyof typeof TILE): string {
  const { fill, stroke } = TILE[theme];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="4" fill="${fill}"/>` +
    `<path d="${markPath(elapsed, 16, 16, 9)}" fill="none" stroke="${stroke}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `</svg>`
  );
}
