// The Uso page's chart: each day's calls stacked per series, after Transitive's settings usage,
// drawn without a chart library.
import { useState } from "react";

export const numberFormat = new Intl.NumberFormat("es-MX");

const AXIS_WEEKDAY = new Intl.DateTimeFormat("es-MX", { weekday: "short", timeZone: "UTC" });
const AXIS_MONTH = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" });
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

/** The y axis: its labels start at the block's padding, like every other line of text. */
const Y_AXIS_WIDTH = 40;
const HEIGHT = 200;

/** A day's label: "lun 26" for a week ("26" on a phone); for a month, every fifth day. */
function axisLabel(day: string, index: number, length: number) {
  const date = usageDay(day);
  if (length <= 7) {
    return (
      <>
        <span className="max-sm:hidden">{AXIS_WEEKDAY.format(date).replace(".", "")} </span>
        {date.getUTCDate()}
      </>
    );
  }
  if ((length - 1 - index) % 5 !== 0) return null;
  return `${date.getUTCDate()} ${AXIS_MONTH.format(date).replace(".", "")}`;
}

/**
 * Each day's calls, stacked per series into a column. Hovering a day keeps it lit, dims the
 * others and shows its counts.
 */
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
  const month = days.length > 7;
  // Half the gap between bars on each side of a day's cell, so the gaps between bars and at
  // both ends are the same.
  const cell = month ? "px-px sm:px-0.5" : "px-1.5 sm:px-3";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex" style={{ height: HEIGHT }}>
        <div
          aria-hidden
          className="relative shrink-0 text-[11px] leading-none text-muted tabular-nums"
          style={{ width: Y_AXIS_WIDTH }}
        >
          {ticks.map((tick, index) => (
            <span
              className="absolute left-0 -translate-y-1/2"
              key={tick}
              style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
            >
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
          <div className="absolute inset-0 flex">
            {days.map((day, index) => (
              <div
                className={`flex flex-1 cursor-crosshair transition-opacity duration-150 ${cell} ${hovered !== null && hovered !== index ? "opacity-40" : ""}`}
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
          {hovered !== null && (
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
        className="flex text-[11px] leading-none whitespace-nowrap text-muted"
        style={{ paddingLeft: Y_AXIS_WIDTH }}
      >
        {days.map((day, index) => (
          // A month's labels are wider than their day: centered on it, overflowing both ways.
          <span className={`relative flex min-w-0 flex-1 justify-center ${cell}`} key={day.date}>
            <span className={month ? "absolute" : undefined}>
              {axisLabel(day.date, index, days.length)}
            </span>
            {month && <span className="invisible">0</span>}
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
      ? { right: `calc(${(1 - left) * 100}% + 12px)` }
      : { left: `calc(${left * 100}% + 12px)` };
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 flex min-w-44 flex-col gap-2 rounded-[4px] border border-line bg-island px-3 py-2.5 text-[13px] leading-4"
      style={side}
    >
      <span className="first-letter:uppercase">{LONG_DAY.format(usageDay(date))}</span>
      {rows.length === 0 && <span className="text-muted">Sin solicitudes</span>}
      {rows.map((row) => (
        <div className="flex items-center justify-between gap-4" key={row.id}>
          <span className="flex min-w-0 items-center gap-2 text-muted">
            <span
              aria-hidden
              className="h-1 w-3 shrink-0 rounded-full"
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
