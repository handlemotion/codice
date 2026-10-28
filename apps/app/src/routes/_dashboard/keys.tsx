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
import { createKey, listKeys, revokeKey } from "../../server/functions";
import type { KeyRow } from "../../server/teams";

export const Route = createFileRoute("/_dashboard/keys")({
  head: () => ({ meta: [{ title: "Claves · Códice" }] }),
  loader: async ({ context }) => {
    const team = context.dashboard.team;
    return { team, keys: team ? await listKeys({ data: team.id }) : [] };
  },
  component: Keys,
});

const FAILED = "No se pudo completar. Intenta de nuevo.";

function Keys() {
  const { dashboard } = Route.useRouteContext();
  const { team, keys } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  function create(event: FormEvent) {
    event.preventDefault();
    if (!team || !name.trim()) return;
    void run(async () => {
      const { key } = await createKey({ data: { organizationId: team.id, name } });
      setCreated(key);
      setName("");
    });
  }

  // Owners and admins revoke any key; members, the ones they created (`permissions.ts`).
  function revocable(key: KeyRow) {
    return team?.manages || key.createdBy?.id === dashboard.user.id;
  }

  function revoke(keyId: string) {
    void run(async () => {
      await revokeKey({ data: keyId });
      setConfirming(null);
    });
  }

  return (
    <Page title="Claves">
      {team ? (
        <Section title="Nueva clave">
          {created ? (
            <div className="flex flex-col gap-3">
              <Copyable label="la clave" value={created} />
              <div className="flex items-center justify-between gap-4">
                <p className="text-[13px] text-muted">Cópiala ahora: no se vuelve a mostrar.</p>
                <button className={SECONDARY} onClick={() => setCreated(null)} type="button">
                  Listo
                </button>
              </div>
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={create}>
              <input
                aria-label="Nombre de la clave"
                className={`${FIELD} flex-1`}
                maxLength={32}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nombre, por ejemplo producción"
                required
                value={name}
              />
              <button className={PRIMARY} disabled={busy || !name.trim()} type="submit">
                Crear clave
              </button>
            </form>
          )}
          {error && <p className="text-[13px] text-muted">{error}</p>}
        </Section>
      ) : (
        <Section title="Nueva clave">
          <p className="text-muted">Únete a un equipo para crear claves.</p>
        </Section>
      )}

      <Section note={team?.name} title="Claves del equipo">
        {keys.length === 0 ? (
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
                {!revocable(key) ? null : confirming === key.id ? (
                  <span className="flex shrink-0 items-center gap-3">
                    <button className={GHOST} onClick={() => setConfirming(null)} type="button">
                      Cancelar
                    </button>
                    <button
                      className={PRIMARY}
                      disabled={busy}
                      onClick={() => revoke(key.id)}
                      type="button"
                    >
                      Revocar
                    </button>
                  </span>
                ) : (
                  <button
                    className={GHOST}
                    disabled={busy}
                    onClick={() => setConfirming(key.id)}
                    type="button"
                  >
                    Revocar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        note={
          <a
            className="underline decoration-line underline-offset-4 hover:text-fg"
            href="/docs/primeros-pasos"
          >
            Guía de inicio
          </a>
        }
        title="Conectar"
      >
        <dl className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted">API</dt>
          <dd>
            <Copyable label="la URL de la API" value={`${ORIGIN}/v1`} />
          </dd>
          <dt className="text-muted">MCP</dt>
          <dd>
            <Copyable label="la URL de MCP" value={`${ORIGIN}/mcp`} />
          </dd>
          <dt className="text-muted">Encabezado</dt>
          <dd>
            <Copyable label="el encabezado" value="Authorization: Bearer cdc_…" />
          </dd>
        </dl>
      </Section>
    </Page>
  );
}
