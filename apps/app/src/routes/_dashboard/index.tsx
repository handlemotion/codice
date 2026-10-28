import {
  IconChevronLeftSmall,
  IconChevronRightSmall,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { Link, createFileRoute, useRouterState } from "@tanstack/react-router";

import { ISLAND, Page, Section } from "../../components/ui";
import {
  MeterRow,
  SeriesRow,
  numberFormat,
  seriesColor,
  usageDay,
  UsageBars,
} from "../../components/usage-chart";
import { getUsage } from "../../server/functions";
import type { UsageSeries, UsageWeek } from "../../server/usage";

/** `hasta`: the week's last day. `por`: the chart's series, keys and clients or people. */
type Search = { hasta?: string; por?: "personas" };

export const Route = createFileRoute("/_dashboard/")({
  head: () => ({ meta: [{ title: "Uso · Códice" }] }),
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search.hasta === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(search.hasta)
      ? { hasta: search.hasta }
      : {}),
    ...(search.por === "personas" ? { por: "personas" as const } : {}),
  }),
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
        <Link
          aria-label="Semana anterior"
          className={step}
          search={(current) => ({ ...current, hasta: previous })}
          to="/"
        >
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
          search={(current) => ({ ...current, hasta: next >= usage.today ? undefined : next })}
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
    <div className={`${ISLAND} grid grid-cols-3 divide-x divide-edge`}>
      {figures.map((figure) => (
        <div className="flex flex-col gap-1 p-4 sm:px-6" key={figure.label}>
          <span className="text-[13px] text-muted">{figure.label}</span>
          <span className="text-[20px] leading-snug tabular-nums">{figure.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Switches the chart between keys and clients and the people behind them. */
function GroupControl({ byPeople }: { byPeople: boolean }) {
  const option = "rounded-[2px] px-2 py-0.5";
  const on = `${option} bg-fg/8 text-fg`;
  const off = `${option} hover:text-fg`;
  return (
    <span className="-my-1 flex items-center gap-1">
      <Link
        aria-current={byPeople ? undefined : "true"}
        className={byPeople ? off : on}
        search={(current) => ({ ...current, por: undefined })}
        to="/"
      >
        Por clave
      </Link>
      <Link
        aria-current={byPeople ? "true" : undefined}
        className={byPeople ? on : off}
        search={(current) => ({ ...current, por: "personas" as const })}
        to="/"
      >
        Por persona
      </Link>
    </span>
  );
}

function seriesHint(entry: UsageSeries) {
  if (entry.kind === "user") return entry.hint;
  const credential = entry.kind === "oauth" ? (entry.hint ?? "MCP") : entry.hint;
  return [credential, entry.person].filter(Boolean).join(" · ") || null;
}

function Usage() {
  const { team, usage } = Route.useLoaderData();
  const { por } = Route.useSearch();
  const byPeople = por === "personas";
  const pending = useRouterState({ select: (state) => state.status === "pending" });

  if (!team || !usage) {
    return (
      <Page title="Uso">
        <Section title="Solicitudes">
          <p className="text-muted">Crea o únete a un equipo para ver su uso.</p>
        </Section>
      </Page>
    );
  }

  const series = (byPeople ? usage.people : usage.series).map((entry, index) => ({
    ...entry,
    color: seriesColor(index),
  }));
  const busiest = usage.operations[0]?.requests ?? 0;

  return (
    <Page action={<WeekControl usage={usage} />} title="Uso">
      <div className={`flex flex-col gap-6 transition-opacity ${pending ? "opacity-60" : ""}`}>
        <Totals usage={usage} />
        <Section
          note={series.length > 0 ? <GroupControl byPeople={byPeople} /> : undefined}
          title="Solicitudes"
        >
          {series.length === 0 ? (
            <p className="text-muted">
              Las llamadas a la API y las herramientas que usan tus asistentes aparecen aquí por
              día.
            </p>
          ) : (
            <>
              <figure aria-label="Solicitudes por día" className="min-w-0">
                <UsageBars days={usage.days} series={series} />
              </figure>
              <ul className="-mb-2 flex flex-col divide-y divide-edge">
                {series.map((entry) => (
                  <SeriesRow
                    color={entry.color}
                    hint={seriesHint(entry)}
                    key={entry.id}
                    label={entry.label}
                    value={requests(entry.requests)}
                  />
                ))}
              </ul>
              <p className="text-[13px] text-muted">
                {byPeople
                  ? `Las claves de ${team.name}, por quien las creó, y tus asistentes, a tu nombre.`
                  : `Las claves de ${team.name} y tus asistentes.`}
              </p>
            </>
          )}
        </Section>
        {usage.operations.length > 0 && (
          <Section note="De la API y de MCP" title="Operaciones">
            <ul className="-my-3.5 flex flex-col divide-y divide-edge">
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
            </ul>
          </Section>
        )}
      </div>
    </Page>
  );
}
