import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import {
  Copyable,
  dateFormat,
  FIELD,
  GHOST,
  ORIGIN,
  PRIMARY,
  Page,
  SECONDARY,
  Section,
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
        <button className={PRIMARY} type="button">
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

/** A row's removal, asked in place: the action, then Cancelar and the action again. */
function Confirm({
  label,
  asking,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  label: string;
  asking: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return asking ? (
    <span className="flex shrink-0 items-center gap-3">
      <button className={GHOST} onClick={onCancel} type="button">
        Cancelar
      </button>
      <button className={PRIMARY} disabled={busy} onClick={onConfirm} type="button">
        {label}
      </button>
    </span>
  ) : (
    <button className={GHOST} disabled={busy} onClick={onAsk} type="button">
      {label}
    </button>
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

  return (
    <Page action={team && <NewKey teamId={team.id} />} title="Claves">
      <Section note={team?.name} title="Claves del equipo">
        {!team ? (
          <p className="text-muted">Únete a un equipo para crear claves.</p>
        ) : keys.length === 0 ? (
          <p className="text-muted">Aún no hay claves.</p>
        ) : (
          <ul className="-my-3 flex flex-col divide-y divide-edge">
            {keys.map((key) => (
              <li className="flex items-center justify-between gap-4 py-3" key={key.id}>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{key.name}</span>
                  <span className="truncate text-[13px] text-muted">
                    <code className="font-mono text-[12px]">{key.start}…</code>
                    {" · "}
                    {key.createdBy
                      ? key.createdBy.id === dashboard.user.id
                        ? "Tuya · "
                        : `De ${key.createdBy.name} · `
                      : ""}
                    {key.lastUsedAt
                      ? `Usada el ${dateFormat.format(new Date(key.lastUsedAt))}`
                      : `Creada el ${dateFormat.format(new Date(key.createdAt))}, sin usar`}
                  </span>
                </div>
                {revocable(key) && (
                  <Confirm
                    asking={confirming === key.id}
                    busy={busy}
                    label="Revocar"
                    onAsk={() => setConfirming(key.id)}
                    onCancel={() => setConfirming(null)}
                    onConfirm={() => void run(() => revokeKey({ data: key.id }))}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Asistentes conectados">
        {clients.length === 0 ? (
          <p className="text-muted">
            Agrega la URL de MCP como conector en Claude, ChatGPT o Cursor y entra con tu cuenta.
          </p>
        ) : (
          <ul className="-my-3 flex flex-col divide-y divide-edge">
            {clients.map((client) => (
              <li className="flex items-center justify-between gap-4 py-3" key={client.clientId}>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{client.name}</span>
                  <span className="truncate text-[13px] text-muted">
                    Conectado el {dateFormat.format(new Date(client.connectedAt))}
                    {client.lastActiveAt
                      ? ` · Activo el ${dateFormat.format(new Date(client.lastActiveAt))}`
                      : " · Sin usar"}
                  </span>
                </div>
                <Confirm
                  asking={confirming === client.clientId}
                  busy={busy}
                  label="Desconectar"
                  onAsk={() => setConfirming(client.clientId)}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() =>
                    void run(() => disconnectConnectedClient({ data: client.clientId }))
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <Copyable label="la URL de MCP" value={`${ORIGIN}/mcp`} />
      </Section>
      {error && <p className="text-[13px] text-muted">{error}</p>}
    </Page>
  );
}
