// The Uso page's pieces, after Transitive's settings usage (its stacked weekly columns, the series
// rows under them and its meters), drawn in the dashboard's language without a chart library.
import { useState, type ReactNode } from "react";

export const numberFormat = new Intl.NumberFormat("es-MX");

/** A day as the axis shows it: "lun 26", or "26" on a phone. */
const AXIS_WEEKDAY = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" });
/** A day as the tooltip shows it: "lunes, 26 de octubre". */
const LONG_DAY = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export function usageDay(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

const SERIES_COLORS = 4;

/** A series keeps its color by its place: the one with the most calls takes the first. */
export function seriesColor(index: number) {
  return `var(--series-${(index % SERIES_COLORS) + 1})`;
}

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
}

/** The y axis's top and step: four steps of a round size, at least 1. */
function scale(max: number) {
  const rough = Math.max(1, max) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((size) => size >= rough);
  const whole = Math.max(1, Math.ceil(step ?? rough));
  return { top: whole * 4, ticks: [4, 3, 2, 1, 0].map((index) => index * whole) };
}

const Y_AXIS_WIDTH = 32;
const HEIGHT = 220;
/** Half the gap between bars, on each side of a day's cell: 12px, 6px on a phone. */
const CELL = "px-1.5 sm:px-3";

/** Each day's calls, stacked per series into a column; hovering a day shows its counts. */
export function UsageBars({
  days,
  series,
}: {
  days: { date: string; requests: Record<string, number> }[];
  series: ChartSeries[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const totals = days.map((day) =>
    series.reduce((sum, entry) => sum + (day.requests[entry.id] ?? 0), 0),
  );
  const { top, ticks } = scale(Math.max(...totals));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex" style={{ height: HEIGHT }}>
        <div
          aria-hidden
          className="flex shrink-0 flex-col justify-between pr-3 text-right text-[11px] leading-none text-muted tabular-nums"
          style={{ width: Y_AXIS_WIDTH }}
        >
          {ticks.map((tick) => (
            <span className="-my-[0.5em]" key={tick}>
              {numberFormat.format(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" onMouseLeave={() => setHovered(null)}>
          {ticks.map((tick, index) => (
            <div
              aria-hidden
              className={`absolute inset-x-0 border-t ${tick === 0 ? "border-line" : "border-dashed border-line/60"}`}
              key={tick}
              style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
            />
          ))}
          {/* Each day is an equal cell with half the gap on either side, so the space between bars
              and at both ends is the same. */}
          <div className="absolute inset-0 flex">
            {days.map((day, index) => (
              <div
                className={`flex flex-1 cursor-crosshair ${CELL} ${hovered === index ? "bg-fg/5" : ""}`}
                key={day.date}
                onMouseEnter={() => setHovered(index)}
              >
                <div className="flex flex-1 flex-col-reverse">
                  {series.map((entry) => {
                    const value = day.requests[entry.id] ?? 0;
                    if (value === 0) return null;
                    return (
                      <div
                        key={entry.id}
                        style={{ height: `${(value / top) * 100}%`, background: entry.color }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {hovered !== null && totals[hovered]! > 0 && (
            <DayTooltip
              date={days[hovered]!.date}
              left={(hovered + 0.5) / days.length}
              rows={series.flatMap((entry) => {
                const value = days[hovered]!.requests[entry.id] ?? 0;
                return value > 0 ? [{ ...entry, value }] : [];
              })}
            />
          )}
        </div>
      </div>
      <div
        aria-hidden
        className="flex text-center text-[11px] text-muted"
        style={{ paddingLeft: Y_AXIS_WIDTH }}
      >
        {days.map((day) => (
          <span className={`min-w-0 flex-1 truncate ${CELL}`} key={day.date}>
            <span className="max-sm:hidden">
              {AXIS_WEEKDAY.format(usageDay(day.date)).replace(".", "")}{" "}
            </span>
            {usageDay(day.date).getUTCDate()}
          </span>
        ))}
      </div>
    </div>
  );
}

function DayTooltip({
  date,
  left,
  rows,
}: {
  date: string;
  left: number;
  rows: (ChartSeries & { value: number })[];
}) {
  // It sits beside the column, on whichever side has room.
  const side =
    left > 0.5
      ? { right: `calc(${(1 - left) * 100}% + 16px)` }
      : { left: `calc(${left * 100}% + 16px)` };
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 flex min-w-44 flex-col gap-1.5 rounded-[4px] border border-line bg-island px-3 py-2 text-[13px]"
      style={side}
    >
      <span className="first-letter:uppercase">{LONG_DAY.format(usageDay(date))}</span>
      {rows.map((row) => (
        <div className="flex items-center justify-between gap-4" key={row.id}>
          <span className="flex min-w-0 items-center gap-2 text-muted">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
            <span className="truncate">{row.label}</span>
          </span>
          <span className="tabular-nums">{numberFormat.format(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * One series of the chart, as a row under it: its color, its name (and a muted hint such as the
 * key's start), and what it used in the week.
 */
export function SeriesRow({
  color,
  hint,
  label,
  value,
}: {
  color: string;
  hint?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint ? <span className="text-muted"> ({hint})</span> : null}
      </span>
      <span className="shrink-0 text-[13px] text-muted tabular-nums">{value}</span>
    </div>
  );
}

/**
 * A share of a whole: the name (and a muted hint) and the amount on one line, the bar under both.
 */
export function MeterRow({
  amount,
  hint,
  label,
  max,
  value,
}: {
  amount: ReactNode;
  hint?: ReactNode;
  label: string;
  max: number;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate">
          {label}
          {hint ? <span className="text-muted"> ({hint})</span> : null}
        </span>
        <span className="shrink-0 text-[13px] text-muted tabular-nums">{amount}</span>
      </div>
      <div
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={0}
        aria-valuenow={value}
        className="h-1.5 overflow-hidden rounded-full bg-fg/10"
        role="meter"
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%`,
            background: seriesColor(0),
          }}
        />
      </div>
    </div>
  );
}
