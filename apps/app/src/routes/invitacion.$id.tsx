import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "../auth-client";
import { Mark } from "../brand/mark";
import { GHOST, PRIMARY, ROLE_LABELS, SECONDARY } from "../components/ui";
import {
  acceptInvitation,
  getDashboard,
  getInvitation,
  rejectInvitation,
} from "../server/functions";

/**
 * Where an invitation's email leads (`invitationUrl` in `src/server/auth.ts`). Signed out, it
 * sends the visitor to sign in and back here; signed in with the invited email, it joins the team
 * or declines. Like `/consent`: one narrow column on the ground, no rail.
 */
export const Route = createFileRoute("/invitacion/$id")({
  head: () => ({ meta: [{ title: "Invitación · Códice" }] }),
  beforeLoad: async ({ params }) => {
    const dashboard = await getDashboard();
    if (!dashboard) {
      throw redirect({ to: "/login", search: { siguiente: `/invitacion/${params.id}` } });
    }
    return { email: dashboard.user.email };
  },
  loader: async ({ params }) => ({ invitation: await getInvitation({ data: params.id }) }),
  component: Invitation,
});

const COLUMN =
  "mx-auto flex min-h-svh w-full max-w-[24rem] flex-col justify-center gap-6 px-4 pt-16 pb-[18svh]";
const WIDE = "flex-1";

function Tile() {
  return (
    <a aria-label="Sitio de Códice" className="w-fit" href="/?site">
      <Mark className="size-6" radius={9} strokeWidth={1.5} />
    </a>
  );
}

function Invitation() {
  const { email } = Route.useRouteContext();
  const { invitation } = Route.useLoaderData();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(accept: boolean) {
    if (!invitation) return;
    setBusy(true);
    setError(null);
    try {
      if (accept) {
        await acceptInvitation({ data: invitation.id });
        await navigate({ to: "/team" });
      } else {
        await rejectInvitation({ data: invitation.id });
        await navigate({ to: "/" });
      }
    } catch {
      setBusy(false);
      setError("No se pudo completar. Intenta de nuevo.");
    }
  }

  async function switchAccount() {
    await authClient.signOut();
    window.location.assign(`/login?siguiente=${encodeURIComponent(window.location.pathname)}`);
  }

  if (!invitation) {
    return (
      <main className={COLUMN}>
        <div className="flex flex-col gap-3">
          <Tile />
          <h1 className="text-[20px] leading-snug">Esta invitación no está abierta</h1>
          <p className="text-muted">
            Venció, ya se usó o es para otro correo. Entraste como{" "}
            <span className="text-fg">{email}</span>.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <a className={PRIMARY} href="/">
            Ir a Códice
          </a>
          <button className={GHOST} onClick={() => void switchAccount()} type="button">
            Entrar con otro correo
          </button>
        </div>
      </main>
    );
  }

  const role = (ROLE_LABELS[invitation.role] ?? invitation.role).toLocaleLowerCase("es");

  return (
    <main className={COLUMN}>
      <div className="flex flex-col gap-3">
        <Tile />
        <div className="flex flex-col gap-1">
          <h1 className="text-[20px] leading-snug">Únete a {invitation.team}</h1>
          <p className="text-muted">
            {invitation.inviter} te invitó como {role}. Verás las claves y el uso del equipo.
          </p>
        </div>
      </div>
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
            Unirme
          </button>
        </div>
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </div>
    </main>
  );
}
