import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient } from "../auth-client";
import { Mark } from "../brand/mark";
import { PRIMARY, SECONDARY } from "../components/ui";
import { getDashboard } from "../server/functions";
import type { ConsentRequest } from "../server/connected-clients";
import { getConsentRequest } from "../server/oauth-functions";

/**
 * Where `/api/auth/oauth2/authorize` sends a signed-in user to approve an MCP client. The query
 * is the authorization's, signed; the answer goes to `/api/auth/oauth2/consent`, and the auth
 * client follows its redirect back to the client. The page reads the query from
 * `window.location`: the router's own search string rewrites the repeated `ba_param` that the
 * signature covers.
 */
export const Route = createFileRoute("/consent")({
  head: () => ({ meta: [{ title: "Conectar · Códice" }] }),
  beforeLoad: async () => {
    if (!(await getDashboard())) throw redirect({ to: "/login" });
  },
  component: Consent,
});

const SCOPE_LABELS: Record<string, string> = {
  "codice:read": "Buscar y leer las reglas y catálogos del SAT en Códice",
  offline_access: "Seguir conectado hasta que lo desconectes",
};

const COLUMN =
  "mx-auto flex min-h-svh w-full max-w-[20rem] flex-col justify-center gap-6 px-4 py-16";
const WIDE = "flex-1";

function Tile() {
  return (
    <a aria-label="Sitio de Códice" className="w-fit" href="/?site">
      <Mark className="size-6" radius={9} strokeWidth={1.5} />
    </a>
  );
}

function Consent() {
  // `undefined` while it loads, `null` for an expired or forged request.
  const [request, setRequest] = useState<ConsentRequest | null>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    setBusy(true);
    setError(null);
    // `oauthProviderClient` adds the page's signed query as `oauth_query`.
    const { error: failure } = await authClient.$fetch("/oauth2/consent", {
      method: "POST",
      body: { accept },
    });
    if (failure) {
      setBusy(false);
      setError("No se pudo completar. Intenta de nuevo.");
    }
  }

  useEffect(() => {
    void getConsentRequest({ data: window.location.search }).then(setRequest, () =>
      setRequest(null),
    );
  }, []);

  if (request === undefined) return null;
  if (!request) {
    return (
      <main className={COLUMN}>
        <div className="flex flex-col gap-3">
          <Tile />
          <h1 className="text-[20px] leading-snug">Esta solicitud venció</h1>
          <p className="text-muted">Vuelve a conectar desde tu aplicación.</p>
        </div>
      </main>
    );
  }

  return (
    <main className={COLUMN}>
      <div className="flex flex-col gap-3">
        <Tile />
        <div className="flex flex-col gap-1">
          <h1 className="text-[20px] leading-snug">¿Conectar {request.client.name} a Códice?</h1>
          <p className="text-muted">
            Volverás a <span className="text-fg">{request.redirectHost}</span>.
            {request.client.uri && (
              <>
                {" "}
                Dice ser <span className="break-all">{request.client.uri}</span>.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-muted">Podrá:</p>
        <ul className="flex flex-col gap-1">
          {request.scopes.map((scope) => (
            <li className="flex gap-2" key={scope}>
              <span aria-hidden className="text-muted">
                ·
              </span>
              {SCOPE_LABELS[scope] ?? scope}
            </li>
          ))}
        </ul>
      </div>

      {request.loopback && (
        <p className="rounded-[4px] border border-edge bg-island p-3 text-[13px]">
          Esta aplicación corre en tu computadora. Conéctala solo si tú la acabas de abrir.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            className={`${SECONDARY} ${WIDE} border-edge bg-island`}
            disabled={busy}
            onClick={() => void answer(false)}
            type="button"
          >
            Rechazar
          </button>
          <button
            className={`${PRIMARY} ${WIDE}`}
            disabled={busy}
            onClick={() => void answer(true)}
            type="button"
          >
            Permitir
          </button>
        </div>
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </div>
    </main>
  );
}
