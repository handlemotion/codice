import {
  IconCheckmark1Small,
  IconSquareBehindSquare1,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  Copyable,
  dateFormat,
  FIELD,
  GHOST,
  ISLAND,
  ORIGIN,
  PRIMARY,
  PRIMARY_SMALL,
  DANGER_SMALL,
  SECONDARY_SMALL,
  Page,
  ROW,
  SECONDARY,
} from "../../components/ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";
import { createKey, listKeys, revokeKey } from "../../server/functions";
import { disconnectConnectedClient, getConnectedClients } from "../../server/oauth-functions";
import type { KeyRow } from "../../server/teams";

export const Route = createFileRoute("/_dashboard/keys")({
  head: () => ({ meta: [{ title: "Claves · Códice" }] }),
  loader: async ({ context }) => {
    const team = context.dashboard.team;
    const [keys, clients] = await Promise.all([
      team ? listKeys({ data: team.id }) : [],
      getConnectedClients(),
    ]);
    return { team, keys, clients };
  },
  component: Keys,
});

const FAILED = "No se pudo completar. Intenta de nuevo.";

/** Connecting an assistant is adding the MCP URL as a connector: one button copies it. */
function CopyMcpUrl() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`${ORIGIN}/mcp`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={SECONDARY_SMALL} onClick={() => void copy()} type="button">
          {copied ? <IconCheckmark1Small size={16} /> : <IconSquareBehindSquare1 size={16} />}
          {copied ? "Copiada" : "URL de MCP"}
        </button>
      </TooltipTrigger>
      <TooltipContent className="font-mono" side="bottom">
        {ORIGIN}/mcp
      </TooltipContent>
    </Tooltip>
  );
}

/** "Nueva clave": a dialog that names the key, then shows it once to copy. */
function NewKey({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(next: boolean) {
    setOpen(next);
    if (!next) {
      setName("");
      setCreated(null);
      setError(null);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { key } = await createKey({ data: { organizationId: teamId, name } });
      setCreated(key);
      await router.invalidate();
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={toggle} open={open}>
      <DialogTrigger asChild>
        <button className={PRIMARY_SMALL} type="button">
          Nueva clave
        </button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Clave creada</DialogTitle>
              <DialogDescription>Cópiala ahora: no se vuelve a mostrar.</DialogDescription>
            </DialogHeader>
            <Copyable label="la clave" value={created} />
            <DialogFooter>
              <DialogClose asChild>
                <button className={SECONDARY} type="button">
                  Listo
                </button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <form className="grid gap-4" onSubmit={(event) => void create(event)}>
            <DialogHeader>
              <DialogTitle>Nueva clave</DialogTitle>
              <DialogDescription>
                Para la API:{" "}
                <code className="font-mono text-[12px]">Authorization: Bearer cdc_…</code>
              </DialogDescription>
            </DialogHeader>
            <input
              aria-label="Nombre de la clave"
              autoFocus
              className={FIELD}
              maxLength={32}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre, por ejemplo producción"
              required
              value={name}
            />
            {error && <p className="text-[13px] text-muted">{error}</p>}
            <DialogFooter>
              <DialogClose asChild>
                <button className={SECONDARY} type="button">
                  Cancelar
                </button>
              </DialogClose>
              <button className={PRIMARY} disabled={busy || !name.trim()} type="submit">
                Crear clave
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A table's rows: a name column, two muted figures of fixed width and the row's action, the same
 * columns in both islands so they line up. On a phone the figures go, so the names keep room.
 */
const TABLE =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:grid-cols-[minmax(0,1fr)_7rem_6.5rem_5.5rem]";
const FIGURE = "truncate text-[13px] text-muted max-sm:hidden";

/** An island whose first row is its title over the names and the columns' names over the rest. */
function TableIsland({
  title,
  columns,
  children,
}: {
  title: string;
  columns: [string, string];
  children: ReactNode;
}) {
  return (
    <section className={`${ISLAND} flex flex-col divide-y divide-line/60 overflow-hidden`}>
      <div className={`${TABLE} ${ROW}`}>
        <h2 className="truncate">{title}</h2>
        <span className={FIGURE}>{columns[0]}</span>
        <span className={FIGURE}>{columns[1]}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * A row: its name, two figures and a quiet action. Asked to confirm, the action takes the
 * figures' room: Cancelar and the action again.
 */
function TableRow({
  name,
  figures,
  action,
  asking,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  name: ReactNode;
  figures: [string, string];
  action?: string;
  asking: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className={`${TABLE} ${ROW}`}>
      <span className="min-w-0 truncate">{name}</span>
      {asking ? (
        <span className="flex items-center justify-end gap-4 sm:col-span-3">
          <button className={GHOST} onClick={onCancel} type="button">
            Cancelar
          </button>
          {/* 28px in a 20px line: the row keeps its height. */}
          <button
            className={`${DANGER_SMALL} -my-1`}
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {action}
          </button>
        </span>
      ) : (
        <>
          <span className={FIGURE}>{figures[0]}</span>
          <span className={FIGURE}>{figures[1]}</span>
          <span className="text-right">
            {action && (
              <button className={GHOST} disabled={busy} onClick={onAsk} type="button">
                {action}
              </button>
            )}
          </span>
        </>
      )}
    </div>
  );
}

function Keys() {
  const { dashboard } = Route.useRouteContext();
  const { team, keys, clients } = Route.useLoaderData();
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setConfirming(null);
      await router.invalidate();
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  // Owners and admins revoke any key; members, the ones they created (`permissions.ts`).
  function revocable(key: KeyRow) {
    return team?.manages || key.createdBy?.id === dashboard.user.id;
  }

  function lastUse(at: string | Date | null | undefined) {
    return at ? dateFormat.format(new Date(at)) : "Sin usar";
  }

  return (
    <Page
      action={
        <div className="flex items-center gap-2">
          <CopyMcpUrl />
          {team && <NewKey teamId={team.id} />}
        </div>
      }
      title="Claves"
    >
      <TableIsland columns={["Creada por", "Último uso"]} title="Claves del equipo">
        {!team || keys.length === 0 ? (
          <p className={`${ROW} text-muted`}>
            {team ? "Aún no hay claves." : "Únete a un equipo para crear claves."}
          </p>
        ) : (
          keys.map((key) => (
            <TableRow
              action={revocable(key) ? "Revocar" : undefined}
              asking={confirming === key.id}
              busy={busy}
              figures={[
                key.createdBy
                  ? key.createdBy.id === dashboard.user.id
                    ? "Tú"
                    : key.createdBy.name
                  : "–",
                lastUse(key.lastUsedAt),
              ]}
              key={key.id}
              name={
                <>
                  {key.name}{" "}
                  <code className="font-mono text-[12px] leading-none text-muted">
                    {key.start}…
                  </code>
                </>
              }
              onAsk={() => setConfirming(key.id)}
              onCancel={() => setConfirming(null)}
              onConfirm={() => void run(() => revokeKey({ data: key.id }))}
            />
          ))
        )}
      </TableIsland>

      <TableIsland columns={["Conectado", "Último uso"]} title="Asistentes">
        {clients.map((client) => (
          <TableRow
            action="Desconectar"
            asking={confirming === client.clientId}
            busy={busy}
            figures={[
              dateFormat.format(new Date(client.connectedAt)),
              lastUse(client.lastActiveAt),
            ]}
            key={client.clientId}
            name={client.name}
            onAsk={() => setConfirming(client.clientId)}
            onCancel={() => setConfirming(null)}
            onConfirm={() => void run(() => disconnectConnectedClient({ data: client.clientId }))}
          />
        ))}
        {clients.length === 0 && <p className={`${ROW} text-muted`}>Ningún asistente conectado.</p>}
      </TableIsland>
      {error && <p className="text-[13px] text-muted">{error}</p>}
    </Page>
  );
}
