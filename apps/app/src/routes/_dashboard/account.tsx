import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { authClient } from "../../auth-client";
import { Avatar } from "../../components/dashboard-shell";
import { FIELD, GHOST, Page, SECONDARY, Section } from "../../components/ui";
import { listMembers, renameUser, setActiveTeam } from "../../server/functions";
import { currentTheme, toggleTheme, type Theme } from "../../theme";

export const Route = createFileRoute("/_dashboard/account")({
  head: () => ({ meta: [{ title: "Cuenta · Códice" }] }),
  loader: async ({ context }) => {
    const team = context.dashboard.team;
    return { members: team ? await listMembers({ data: team.id }) : [] };
  },
  component: Account,
});

const ROLES: Record<string, string> = {
  owner: "Propietario",
  admin: "Administrador",
  member: "Miembro",
};

const ROW = "flex items-center justify-between gap-4 py-3";
const LIST = "-my-3 flex flex-col divide-y divide-edge";

function Account() {
  const { dashboard } = Route.useRouteContext();
  const { members } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const [name, setName] = useState(dashboard.user.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");

  // The theme lives on <html>, so it is read once mounted; T may change it from anywhere.
  useEffect(() => {
    setTheme(currentTheme());
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
    } catch {
      setError("No se pudo completar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function rename(event: FormEvent) {
    event.preventDefault();
    void run(() => renameUser({ data: name }));
  }

  async function signOut() {
    await authClient.signOut();
    await navigate({ to: "/login" });
  }

  const renamed = name.trim() && name.trim() !== dashboard.user.name;

  return (
    <Page title="Cuenta">
      <Section title="Perfil">
        <div className="flex items-center gap-4">
          <Avatar size={40} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate">{dashboard.user.name}</span>
            <span className="truncate text-[13px] text-muted">{dashboard.user.email}</span>
          </div>
        </div>
        <form className="flex gap-2" onSubmit={rename}>
          <input
            aria-label="Nombre"
            autoComplete="name"
            className={`${FIELD} flex-1`}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tu nombre"
            value={name}
          />
          <button className={SECONDARY} disabled={busy || !renamed} type="submit">
            Guardar
          </button>
        </form>
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </Section>

      <Section note={dashboard.team?.name} title="Equipo">
        {members.length === 0 ? (
          <p className="text-muted">No perteneces a ningún equipo.</p>
        ) : (
          <ul className={LIST}>
            {members.map((member) => (
              <li className={ROW} key={member.id}>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{member.name}</span>
                  <span className="truncate text-[13px] text-muted">{member.email}</span>
                </div>
                <span className="shrink-0 text-[13px] text-muted">
                  {ROLES[member.role] ?? member.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {dashboard.teams.length > 1 && (
        <Section title="Tus equipos">
          <ul className={LIST}>
            {dashboard.teams.map((team) => (
              <li className={ROW} key={team.id}>
                <span className="truncate">{team.name}</span>
                {team.id === dashboard.team?.id ? (
                  <span className="text-[13px] text-muted">Actual</span>
                ) : (
                  <button
                    className={GHOST}
                    disabled={busy}
                    onClick={() => void run(() => setActiveTeam({ data: team.id }))}
                    type="button"
                  >
                    Cambiar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Preferencias">
        <ul className={LIST}>
          <li className={ROW}>
            <span>Tema</span>
            <button className={SECONDARY} onClick={() => setTheme(toggleTheme())} type="button">
              {theme === "dark" ? "Oscuro" : "Claro"}
            </button>
          </li>
          <li className={ROW}>
            <span>Sesión</span>
            <button className={SECONDARY} onClick={() => void signOut()} type="button">
              Cerrar sesión
            </button>
          </li>
        </ul>
      </Section>
    </Page>
  );
}
