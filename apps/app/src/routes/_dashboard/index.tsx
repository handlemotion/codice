import {
  IconCalendar1,
  IconChevronLeftSmall,
  IconChevronRightSmall,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Group, ISLAND, Page, ROW } from "../../components/ui";
import { numberFormat, seriesColor, usageDay, UsageBars } from "../../components/usage-chart";
import { getUsage } from "../../server/functions";
import type { UsagePeriod, UsagePeriodData, UsageSeries, UsageView } from "../../server/usage";

type Scope = "claves" | "miembros";
type Search = { hasta?: string; dias?: 30; vista?: "miembros" };

export const Route = createFileRoute("/_dashboard/")({
  head: () => ({ meta: [{ title: "Uso · Códice" }] }),
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.hasta === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(search.hasta)
      ? { hasta: search.hasta }
      : {}),
    ...(Number(search.dias) === 30 ? { dias: 30 as const } : {}),
    ...(search.vista === "miembros" ? { vista: "miembros" as const } : {}),
  }),
  // The scope is a tab over data already loaded; only the period loads anew.
  loaderDeps: ({ search }) => ({ end: search.hasta, days: search.dias ?? 7 }),
  loader: async ({ context, deps }) => {
    const team = context.dashboard.team;
    return {
      team,
      usage: team
        ? await getUsage({ data: { organizationId: team.id, end: deps.end, days: deps.days } })
        : null,
    };
  },
  component: Usage,
});

/** The names `/v1` and MCP share for each operation (apps/api/SPEC.md, "Usage"). */
const OPERATIONS: Record<string, string> = {
  search: "Buscar",
  read_passage: "Leer un pasaje",
  lookup_error: "Consultar un error",
  lookup_catalog: "Consultar un catálogo",
  list_catalog: "Listar un catálogo",
  list_sources: "Listar las fuentes",
  list_changes: "Listar los cambios",
  read_source: "Leer una fuente",
  chat: "Chat",
};

const SHORT_DAY = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function shortDay(day: string) {
  return SHORT_DAY.format(usageDay(day)).replace(".", "");
}

function addDays(day: string, days: number) {
  const date = usageDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The change against the period before: "+12 %", "nuevo", or a dash. */
function change(current: number, previous: number) {
  if (previous === 0) return current > 0 ? "nuevo" : "–";
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent > 0 ? "+" : ""}${numberFormat.format(percent)} %`;
}

function percent(part: number, whole: number) {
  return whole > 0 ? `${numberFormat.format(Math.round((part / whole) * 1000) / 10)} %` : "–";
}

// The page's controls take the island's look: white by day, a hairline at night.
const CONTROL = "flex h-8 items-center rounded-[2px] border border-edge bg-island text-[13px]";
const STEP = "grid h-full w-8 place-items-center text-muted hover:text-fg";
const STEP_OFF = "grid h-full w-8 place-items-center text-muted opacity-40";

/** 7 or 30 days. */
function PeriodSwitch({ days }: { days: UsagePeriod }) {
  return (
    <div className={`${CONTROL} p-0.5`}>
      {([7, 30] as const).map((length) => (
        <Link
          aria-current={length === days ? "true" : undefined}
          className={`grid h-full place-items-center rounded-[2px] px-2.5 ${length === days ? "bg-ink text-fg" : "text-muted hover:text-fg"}`}
          key={length}
          search={(current) => ({
            ...(current.vista ? { vista: current.vista } : {}),
            ...(length === 30 ? { dias: 30 as const } : {}),
          })}
          to="/"
        >
          {length} días
        </Link>
      ))}
    </div>
  );
}

/** Steps the period back and forth; the latest one, ending today, is the page without `hasta`. */
function PeriodStepper({ usage }: { usage: UsagePeriodData }) {
  const previous = addDays(usage.end, -usage.days);
  const next = addDays(usage.end, usage.days);
  const atStart = !usage.earliest || usage.start <= usage.earliest;
  const atEnd = usage.end >= usage.today;
  return (
    <div className={CONTROL}>
      {atStart ? (
        <span aria-hidden className={STEP_OFF}>
          <IconChevronLeftSmall size={16} />
        </span>
      ) : (
        <Link
          aria-label="Periodo anterior"
          className={STEP}
          search={(current) => ({ ...current, hasta: previous })}
          to="/"
        >
          <IconChevronLeftSmall size={16} />
        </Link>
      )}
      <span className="flex items-center gap-2 px-1 tabular-nums">
        <IconCalendar1 className="text-muted" size={16} />
        {shortDay(usage.start)} – {shortDay(usage.end)}
      </span>
      {atEnd ? (
        <span aria-hidden className={STEP_OFF}>
          <IconChevronRightSmall size={16} />
        </span>
      ) : (
        <Link
          aria-label="Periodo siguiente"
          className={STEP}
          search={(current) => {
            const { hasta: _, ...rest } = current;
            return next >= usage.today ? rest : { ...rest, hasta: next };
          }}
          to="/"
        >
          <IconChevronRightSmall size={16} />
        </Link>
      )}
    </div>
  );
}

/** The card's tabs, along its top: the team's keys, or its members. */
function ScopeTabs({ scope }: { scope: Scope }) {
  const tabs: [Scope, string][] = [
    ["claves", "Claves"],
    ["miembros", "Miembros"],
  ];
  return (
    <nav aria-label="Ver por" className="flex gap-6 px-5">
      {tabs.map(([value, label]) => (
        <Link
          aria-current={value === scope ? "page" : undefined}
          className={`relative pt-4 pb-3.5 leading-5 ${value === scope ? "text-fg after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-fg" : "text-muted hover:text-fg"}`}
          key={value}
          search={(current) => {
            const { vista: _, ...rest } = current;
            return value === "miembros" ? { ...rest, vista: "miembros" as const } : rest;
          }}
          to="/"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The period's total, large, with its change, and the error rate and mean time beside it. The
 * large number takes more room than a row's 20px: 28px on a 32px line leaves 5px over the
 * capitals, so 19px over the box puts them 24px under the tabs.
 */
function Headline({ view, days }: { view: UsageView; days: UsagePeriod }) {
  const { totals, previous } = view;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-5 pt-[19px]">
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] leading-8 tabular-nums">
          {numberFormat.format(totals.requests)}
        </span>
        <span className="text-muted">solicitudes</span>
        <span className="text-[13px] text-muted tabular-nums">
          {change(totals.requests, previous.requests)}{" "}
          {days === 7 ? "vs. la semana anterior" : "vs. los 30 días anteriores"}
        </span>
      </div>
      <div className="flex items-baseline gap-4 text-[13px] text-muted tabular-nums">
        <span>{percent(totals.errors, totals.requests)} errores</span>
        <span>
          {totals.meanMs === null ? "–" : `${numberFormat.format(totals.meanMs)} ms`} de media
        </span>
      </div>
    </div>
  );
}

/**
 * A table's rows: a name column, then right-aligned figures of fixed width. On a phone the
 * middle figure (the share, or the errors) goes, so the names keep their room.
 */
const TABLE =
  "grid grid-cols-[minmax(0,1fr)_4.5rem_4rem] items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_4.5rem_3.5rem_4rem]";

/**
 * A table on its own island. Its first row is both its title and its column names: the title in
 * `fg` over the names, the columns' names in `muted` over the figures.
 */
function TableIsland({
  title,
  columns,
  children,
}: {
  title: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <section className={`${ISLAND} flex flex-col divide-y divide-line/60 overflow-hidden`}>
      <div className={`${TABLE} ${ROW}`}>
        <h2>{title}</h2>
        {columns.map((column, index) => (
          <span
            className={`text-right text-[13px] text-muted ${index === 1 ? "max-sm:hidden" : ""}`}
            key={column}
          >
            {column}
          </span>
        ))}
      </div>
      {children}
    </section>
  );
}

function TableRow({
  name,
  figures,
}: {
  name: ReactNode;
  figures: [ReactNode, ReactNode, ReactNode];
}) {
  return (
    <div className={`${TABLE} ${ROW}`}>
      <span className="flex min-w-0 items-center gap-3 self-center">{name}</span>
      <span className="text-right tabular-nums">{figures[0]}</span>
      <span className="text-right text-[13px] text-muted tabular-nums max-sm:hidden">
        {figures[1]}
      </span>
      <span className="text-right text-[13px] text-muted tabular-nums">{figures[2]}</span>
    </div>
  );
}

/** A key's color square, or a member's photo or initial on their color. */
function SeriesMark({ entry, color }: { entry: UsageSeries; color: string }) {
  if (entry.id.startsWith("api_key:")) {
    return (
      <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
    );
  }
  return (
    <span
      aria-hidden
      className="grid size-5 shrink-0 place-items-center overflow-hidden rounded-full text-[11px] leading-none text-white"
      style={{ background: color }}
    >
      {entry.image ? (
        <img alt="" className="size-full object-cover" src={entry.image} />
      ) : (
        entry.label.charAt(0).toLocaleUpperCase("es")
      )}
    </span>
  );
}

const EMPTY: Record<Scope, string> = {
  claves: "Las llamadas con las claves del equipo aparecen aquí por día.",
  miembros:
    "Las llamadas de cada miembro, con las claves que creó y sus asistentes, aparecen aquí por día.",
};

function UsageCard({ usage, scope }: { usage: UsagePeriodData; scope: Scope }) {
  const view = scope === "claves" ? usage.keys : usage.members;
  const series = view.series.map((entry, index) => ({ ...entry, color: seriesColor(index) }));
  return (
    <>
      <section className={`${ISLAND} flex flex-col divide-y divide-line/60 overflow-hidden`}>
        <ScopeTabs scope={scope} />
        <div>
          <Headline days={usage.days} view={view} />
          {/* The number's line ends 7px under its baseline and the top tick's capitals sit 4.5px
              over its line, so 28px between leaves 40px from the number to the chart. The day
              labels end 2px over their box: 18px under them leaves 20px to the island's edge. */}
          {series.length === 0 ? (
            <p className="px-5 pt-[29px] pb-3.5 leading-5 text-muted">{EMPTY[scope]}</p>
          ) : (
            <figure aria-label="Solicitudes por día" className="min-w-0 px-5 pt-7 pb-[18px]">
              <UsageBars days={view.days} series={series} />
            </figure>
          )}
        </div>
      </section>
      {series.length > 0 && (
        <TableIsland
          columns={["Solicitudes", "Parte", "Cambio"]}
          title={scope === "claves" ? "Claves" : "Miembros"}
        >
          {series.map((entry) => (
            <TableRow
              figures={[
                numberFormat.format(entry.requests),
                percent(entry.requests, view.totals.requests),
                change(entry.requests, entry.previous),
              ]}
              key={entry.id}
              name={
                <>
                  <SeriesMark color={entry.color} entry={entry} />
                  <span className="min-w-0 truncate">
                    {entry.label}
                    {entry.hint && <span className="text-muted"> {entry.hint}</span>}
                  </span>
                </>
              }
            />
          ))}
        </TableIsland>
      )}
    </>
  );
}

function Operations({ view }: { view: UsageView }) {
  if (view.operations.length === 0) return null;
  return (
    <TableIsland columns={["Solicitudes", "Errores", "Cambio"]} title="Operaciones">
      {view.operations.map((operation) => (
        <TableRow
          figures={[
            numberFormat.format(operation.requests),
            operation.errors > 0 ? numberFormat.format(operation.errors) : "–",
            change(operation.requests, operation.previous),
          ]}
          key={operation.operation}
          name={
            <span className="min-w-0 truncate">
              {OPERATIONS[operation.operation] ?? operation.operation}
              <span className="font-mono text-[12px] leading-none text-muted max-sm:hidden">
                {" "}
                {operation.operation}
              </span>
            </span>
          }
        />
      ))}
    </TableIsland>
  );
}

function Usage() {
  const { team, usage } = Route.useLoaderData();
  const { vista } = Route.useSearch();
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  const scope: Scope = vista ?? "claves";

  if (!team || !usage) {
    return (
      <Page title="Uso">
        <Group title="Solicitudes">
          <p className={`${ROW} text-muted`}>Crea o únete a un equipo para ver su uso.</p>
        </Group>
      </Page>
    );
  }

  return (
    <Page
      action={
        <div className="flex items-center gap-2">
          <PeriodSwitch days={usage.days} />
          <PeriodStepper usage={usage} />
        </div>
      }
      title="Uso"
    >
      <div className={`flex flex-col gap-6 transition-opacity ${pending ? "opacity-60" : ""}`}>
        <UsageCard scope={scope} usage={usage} />
        <Operations view={scope === "claves" ? usage.keys : usage.members} />
      </div>
    </Page>
  );
}
