import {
  IconChevronLeftSmall,
  IconChevronRightSmall,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";

import { Group, Page } from "../../components/ui";
import {
  MeterRow,
  SeriesRow,
  numberFormat,
  seriesColor,
  usageDay,
  UsageBars,
} from "../../components/usage-chart";
import { getUsage } from "../../server/functions";
import type { UsageWeek } from "../../server/usage";

type Search = { hasta?: string };

export const Route = createFileRoute("/_dashboard/")({
  head: () => ({ meta: [{ title: "Uso · Códice" }] }),
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.hasta === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(search.hasta)
      ? { hasta: search.hasta }
      : {},
  loaderDeps: ({ search }) => ({ end: search.hasta }),
  loader: async ({ context, deps }) => {
    const team = context.dashboard.team;
    return {
      team,
      usage: team ? await getUsage({ data: { organizationId: team.id, end: deps.end } }) : null,
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

function requests(count: number) {
  return `${numberFormat.format(count)} ${count === 1 ? "solicitud" : "solicitudes"}`;
}

/** Steps the week back and forth; the latest week, ending today, is the page without `hasta`. */
function WeekControl({ usage }: { usage: UsageWeek }) {
  const previous = addDays(usage.end, -7);
  const next = addDays(usage.end, 7);
  const atStart = !usage.earliest || usage.start <= usage.earliest;
  const atEnd = usage.end >= usage.today;
  const step = "grid size-8 place-items-center text-muted hover:text-fg";
  const off = "grid size-8 place-items-center text-muted opacity-40";
  return (
    <div className="-mr-2 flex items-center">
      {atStart ? (
        <span aria-hidden className={off}>
          <IconChevronLeftSmall size={16} />
        </span>
      ) : (
        <Link aria-label="Semana anterior" className={step} search={{ hasta: previous }} to="/">
          <IconChevronLeftSmall size={16} />
        </Link>
      )}
      <span className="min-w-28 text-center text-[13px] text-muted tabular-nums">
        {shortDay(usage.start)} – {shortDay(usage.end)}
      </span>
      {atEnd ? (
        <span aria-hidden className={off}>
          <IconChevronRightSmall size={16} />
        </span>
      ) : (
        <Link
          aria-label="Semana siguiente"
          className={step}
          search={next >= usage.today ? {} : { hasta: next }}
          to="/"
        >
          <IconChevronRightSmall size={16} />
        </Link>
      )}
    </div>
  );
}

function Totals({ usage }: { usage: UsageWeek }) {
  const { requests: count, errors, meanMs } = usage.totals;
  const figures = [
    { label: "Solicitudes", value: numberFormat.format(count) },
    {
      label: "Errores",
      value: count > 0 ? `${numberFormat.format(Math.round((errors / count) * 1000) / 10)} %` : "–",
    },
    { label: "Tiempo medio", value: meanMs === null ? "–" : `${numberFormat.format(meanMs)} ms` },
  ];
  return (
    <Group title="Resumen">
      <div className="grid grid-cols-3 divide-x divide-line/60">
        {figures.map((figure) => (
          <div className="flex flex-col gap-1 p-4" key={figure.label}>
            <span className="text-[13px] text-muted">{figure.label}</span>
            <span className="text-[20px] leading-snug tabular-nums">{figure.value}</span>
          </div>
        ))}
      </div>
    </Group>
  );
}

function Usage() {
  const { team, usage } = Route.useLoaderData();
  const pending = useRouterState({ select: (state) => state.status === "pending" });

  if (!team || !usage) {
    return (
      <Page inset title="Uso">
        <Group title="Solicitudes">
          <p className="p-4 text-muted">Crea o únete a un equipo para ver su uso.</p>
        </Group>
      </Page>
    );
  }

  const series = usage.series.map((entry, index) => ({
    ...entry,
    color: seriesColor(index),
  }));
  const busiest = usage.operations[0]?.requests ?? 0;

  return (
    <Page action={<WeekControl usage={usage} />} inset title="Uso">
      <div className={`flex flex-col gap-8 transition-opacity ${pending ? "opacity-60" : ""}`}>
        <Totals usage={usage} />
        <Group
          note={series.length > 0 ? `Claves de ${team.name} y tus asistentes` : undefined}
          title="Solicitudes"
        >
          {series.length === 0 ? (
            <p className="p-4 text-muted">
              Las llamadas a la API y las herramientas que usan tus asistentes aparecen aquí por
              día.
            </p>
          ) : (
            <>
              <figure aria-label="Solicitudes por día" className="min-w-0 p-4">
                <UsageBars days={usage.days} series={series} />
              </figure>
              {series.map((entry) => (
                <SeriesRow
                  color={entry.color}
                  hint={entry.kind === "oauth" ? (entry.hint ?? "MCP") : entry.hint}
                  key={entry.id}
                  label={entry.label}
                  value={requests(entry.requests)}
                />
              ))}
            </>
          )}
        </Group>
        {usage.operations.length > 0 && (
          <Group note="De la API y de MCP" title="Operaciones">
            {usage.operations.map((operation) => (
              <MeterRow
                amount={
                  operation.errors > 0
                    ? `${requests(operation.requests)} · ${numberFormat.format(operation.errors)} con error`
                    : requests(operation.requests)
                }
                hint={operation.operation}
                key={operation.operation}
                label={OPERATIONS[operation.operation] ?? operation.operation}
                max={busiest}
                value={operation.requests}
              />
            ))}
          </Group>
        )}
      </div>
    </Page>
  );
}
