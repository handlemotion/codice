import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient } from "../auth-client";
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
  beforeLoad: async () => {
    if (!(await getDashboard())) throw redirect({ to: "/login" });
  },
  component: Consent,
});

const SCOPE_LABELS: Record<string, string> = {
  "codice:read": "Search and read Códice's SAT rules and catalogs",
  offline_access: "Stay connected until you disconnect it",
};

const button = "rounded-md border px-4 py-2 text-sm disabled:opacity-50";

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
      setError(failure.message ?? "Something went wrong");
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
      <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-24">
        <h1 className="text-2xl font-semibold tracking-tight">This request has expired</h1>
        <p className="text-sm text-stone-600">Start the connection again from your app.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">
        Connect {request.client.name} to Códice?
      </h1>
      <p className="text-sm text-stone-600">It will be able to:</p>
      <ul className="list-disc pl-5 text-sm">
        {request.scopes.map((scope) => (
          <li key={scope}>{SCOPE_LABELS[scope] ?? scope}</li>
        ))}
      </ul>
      <p className="text-sm text-stone-600">
        You will return to <strong>{request.redirectHost}</strong>.
        {request.client.uri ? (
          <>
            {" "}
            The app says it is <span className="break-all">{request.client.uri}</span>.
          </>
        ) : null}
      </p>
      {request.loopback ? (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          This app runs on your computer. Connect it only if you just started it yourself.
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          className={`${button} border-stone-900 bg-stone-900 text-white hover:bg-stone-700`}
          disabled={busy}
          onClick={() => void answer(true)}
          type="button"
        >
          Allow
        </button>
        <button
          className={`${button} border-stone-300 bg-white hover:bg-stone-100`}
          disabled={busy}
          onClick={() => void answer(false)}
          type="button"
        >
          Deny
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
