import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { DashboardShell } from "../../components/dashboard-shell";
import { createKey, listKeys, revokeKey } from "../../server/functions";

export const Route = createFileRoute("/_dashboard/keys")({
  loader: async ({ context }) => {
    const team = context.dashboard.team;
    return { team, keys: team ? await listKeys({ data: team.id }) : [] };
  },
  component: Keys,
});

const dateFormat = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

function Keys() {
  const { team, keys } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
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

  function revoke(keyId: string, keyName: string | null) {
    if (!window.confirm(`Revoke ${keyName ?? "this key"}? Calls that use it start failing.`))
      return;
    void run(() => revokeKey({ data: keyId }));
  }

  return (
    <DashboardShell title="API keys">
      <p className="text-stone-600">
        Every call to <code>/v1</code> and <code>/mcp</code> needs a key of the team, sent as{" "}
        <code>Authorization: Bearer cdc_…</code> or <code>x-api-key</code>.
      </p>
      {team ? (
        <form className="flex max-w-lg gap-2" onSubmit={create}>
          <input
            aria-label="Key name"
            className="flex-1 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
            maxLength={32}
            onChange={(event) => setName(event.target.value)}
            placeholder="Key name, e.g. production"
            required
            value={name}
          />
          <button
            className="rounded-md bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy || !name.trim()}
            type="submit"
          >
            Create key
          </button>
        </form>
      ) : (
        <p className="text-stone-600">Join or create a team to issue keys.</p>
      )}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {created ? (
        <div className="flex max-w-2xl flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium">Copy the key now: it is not shown again.</p>
          <code className="break-all rounded bg-white px-2 py-1 text-sm">{created}</code>
          <div className="flex gap-2">
            <button
              className="text-sm underline"
              onClick={() => void navigator.clipboard.writeText(created)}
              type="button"
            >
              Copy
            </button>
            <button className="text-sm underline" onClick={() => setCreated(null)} type="button">
              Done
            </button>
          </div>
        </div>
      ) : null}
      <table className="max-w-3xl text-left text-sm">
        <thead className="text-stone-500">
          <tr>
            <th className="py-2 pr-6 font-normal">Name</th>
            <th className="py-2 pr-6 font-normal">Key</th>
            <th className="py-2 pr-6 font-normal">Created</th>
            <th className="py-2 pr-6 font-normal">Last used</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr className="border-t border-stone-200" key={key.id}>
              <td className="py-2 pr-6">{key.name}</td>
              <td className="py-2 pr-6 font-mono">{key.start}…</td>
              <td className="py-2 pr-6">{dateFormat.format(new Date(key.createdAt))}</td>
              <td className="py-2 pr-6">
                {key.lastUsedAt ? dateFormat.format(new Date(key.lastUsedAt)) : "Never"}
              </td>
              <td className="py-2">
                <button
                  className="text-red-700 hover:underline disabled:opacity-50"
                  disabled={busy}
                  onClick={() => revoke(key.id, key.name)}
                  type="button"
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
          {keys.length === 0 ? (
            <tr className="border-t border-stone-200">
              <td className="py-2 text-stone-500" colSpan={5}>
                No keys yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </DashboardShell>
  );
}
