import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { authClient } from "../../auth-client";
import { Avatar } from "../../components/dashboard-shell";
import {
  FIELD,
  GHOST,
  LIST,
  PRIMARY,
  Page,
  ROLE_LABELS,
  LIST_ROW,
  SECONDARY,
  Section,
} from "../../components/ui";
import {
  acceptInvitation,
  getReceivedInvitations,
  rejectInvitation,
  renameUser,
} from "../../server/functions";
import { currentTheme, toggleTheme, type Theme } from "../../theme";

export const Route = createFileRoute("/_dashboard/account")({
  head: () => ({ meta: [{ title: "Cuenta · Códice" }] }),
  loader: async () => ({ invitations: await getReceivedInvitations() }),
  component: Account,
});

/**
 * The user's own account, behind the avatar: their profile, invitations waiting for them and
 * preferences. Teams are switched and created from the rail's top (`team-switcher.tsx`); the
 * active team's own settings are on Configuración (`settings.tsx`).
 */
function Account() {
  const { dashboard } = Route.useRouteContext();
  const { invitations } = Route.useLoaderData();
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

      {invitations.length > 0 && (
        <Section title="Invitaciones">
          <ul className={LIST}>
            {invitations.map((invitation) => (
              <li className={LIST_ROW} key={invitation.id}>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{invitation.team}</span>
                  <span className="truncate text-[13px] text-muted">
                    Como {(ROLE_LABELS[invitation.role] ?? invitation.role).toLocaleLowerCase("es")}
                  </span>
                </div>
                <span className="flex shrink-0 items-center gap-3">
                  <button
                    className={GHOST}
                    disabled={busy}
                    onClick={() => void run(() => rejectInvitation({ data: invitation.id }))}
                    type="button"
                  >
                    Rechazar
                  </button>
                  <button
                    className={PRIMARY}
                    disabled={busy}
                    onClick={() => void run(() => acceptInvitation({ data: invitation.id }))}
                    type="button"
                  >
                    Unirme
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Preferencias">
        <ul className={LIST}>
          <li className={LIST_ROW}>
            <span>Tema</span>
            <button className={SECONDARY} onClick={() => setTheme(toggleTheme())} type="button">
              {theme === "dark" ? "Oscuro" : "Claro"}
            </button>
          </li>
          <li className={LIST_ROW}>
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
