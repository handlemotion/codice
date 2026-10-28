import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Copyable, GHOST, ORIGIN, PRIMARY, Page, Section, dateFormat } from "../../components/ui";
import { disconnectClient, listClients } from "../../server/functions";

export const Route = createFileRoute("/_dashboard/clients")({
  head: () => ({ meta: [{ title: "Clientes · Códice" }] }),
  loader: async ({ context }) => {
    const team = context.dashboard.team;
    return { team, clients: team ? await listClients({ data: team.id }) : [] };
  },
  component: Clients,
});

function Clients() {
  const { team, clients } = Route.useLoaderData();
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function disconnect(clientId: string) {
    setBusy(true);
    setError(null);
    try {
      await disconnectClient({ data: clientId });
      setConfirming(null);
      await router.invalidate();
    } catch {
      setError("No se pudo desconectar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Clientes">
      <Section note={team?.name} title="Conectados">
        {clients.length === 0 ? (
          <p className="text-muted">Ningún asistente está conectado.</p>
        ) : (
          <ul className="-my-3 flex flex-col divide-y divide-edge">
            {clients.map((client) => (
              <li className="flex items-center justify-between gap-4 py-3" key={client.id}>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{client.name}</span>
                  <span className="truncate text-[13px] text-muted">
                    Conectado el {dateFormat.format(new Date(client.connectedAt))}
                    {client.lastUsedAt
                      ? ` · Usado el ${dateFormat.format(new Date(client.lastUsedAt))}`
                      : " · Sin usar"}
                  </span>
                </div>
                {confirming === client.id ? (
                  <span className="flex shrink-0 items-center gap-3">
                    <button className={GHOST} onClick={() => setConfirming(null)} type="button">
                      Cancelar
                    </button>
                    <button
                      className={PRIMARY}
                      disabled={busy}
                      onClick={() => void disconnect(client.id)}
                      type="button"
                    >
                      Desconectar
                    </button>
                  </span>
                ) : (
                  <button
                    className={GHOST}
                    disabled={busy}
                    onClick={() => setConfirming(client.id)}
                    type="button"
                  >
                    Desconectar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </Section>

      <Section
        note={
          <a
            className="underline decoration-line underline-offset-4 hover:text-fg"
            href="/docs/mcp"
          >
            Guía de MCP
          </a>
        }
        title="Conectar un asistente"
      >
        <Copyable label="la URL de MCP" value={`${ORIGIN}/mcp`} />
        <p className="text-[13px] text-muted">
          Agrégala como conector en Claude, ChatGPT o Cursor y entra con tu cuenta.
        </p>
      </Section>
    </Page>
  );
}
