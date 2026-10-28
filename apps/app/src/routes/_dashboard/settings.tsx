import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import {
  AddRow,
  dateFormat,
  FIELD,
  GHOST,
  LIST,
  PRIMARY,
  Page,
  PersonAvatar,
  ROLE_LABELS,
  LIST_ROW,
  RoleBadge,
  SECONDARY,
  Section,
  Select,
} from "../../components/ui";
import {
  cancelInvitation,
  changeMemberRole,
  getTeamPeople,
  inviteMember,
  leaveTeam,
  removeMember,
  renameTeam,
} from "../../server/functions";
import type { MemberRow } from "../../server/teams";

/**
 * The active team's settings, after Transitive's members settings: its name, its members with
 * their roles, the invitations still open, and leaving it. Owners and admins change everything;
 * members see it all and may leave.
 */
export const Route = createFileRoute("/_dashboard/settings")({
  head: () => ({ meta: [{ title: "Equipo · Códice" }] }),
  loader: async ({ context }) => {
    const team = context.dashboard.team;
    return { team, people: team ? await getTeamPeople({ data: team.id }) : null };
  },
  component: TeamSettings,
});

const FAILED = "No se pudo completar. Intenta de nuevo.";

/** Only an owner makes someone an owner; Better Auth refuses it to an admin. */
function rolesFor(role: string) {
  const options = ["member", "admin"];
  if (role.includes("owner")) options.push("owner");
  return options;
}

function TeamSettings() {
  const { dashboard } = Route.useRouteContext();
  const { team, people } = Route.useLoaderData();
  const router = useRouter();
  const [name, setName] = useState(team?.name ?? "");
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  // Another team may become the active one (switched or left) while the page is open.
  useEffect(() => setName(team?.name ?? ""), [team?.id, team?.name]);

  if (!team || !people) {
    return (
      <Page title="Configuración">
        <Section title="Equipo">
          <p className="text-muted">No perteneces a ningún equipo. Crea uno desde tu cuenta.</p>
        </Section>
      </Page>
    );
  }

  const organizationId = team.id;
  const manages = team.manages;
  const owners = people.members.filter((member) => member.role.includes("owner")).length;

  async function run(action: () => Promise<unknown>, failure = FAILED) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch {
      setError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function rename(event: FormEvent) {
    event.preventDefault();
    void run(() => renameTeam({ data: { organizationId, name } }));
  }

  function invite(event: FormEvent) {
    event.preventDefault();
    const to = email.trim();
    void run(
      () => inviteMember({ data: { organizationId, email: to, role: inviteRole } }),
      "No se pudo enviar la invitación. Revisa el correo.",
    ).then((ok) => {
      if (!ok) return;
      setSentTo(to);
      setEmail("");
      setInviteRole("member");
      setInviting(false);
    });
  }

  function memberActions(member: MemberRow) {
    const self = member.userId === dashboard.user.id;
    // Only an owner changes or removes another owner.
    const outranks = member.role.includes("owner") && !team!.role.includes("owner");
    if (!manages || self || outranks) return <RoleBadge role={member.role} />;
    if (confirming === member.id) {
      return (
        <span className="flex shrink-0 items-center gap-3">
          <button className={GHOST} onClick={() => setConfirming(null)} type="button">
            Cancelar
          </button>
          <button
            className={PRIMARY}
            disabled={busy}
            onClick={() =>
              void run(() => removeMember({ data: { organizationId, memberId: member.id } })).then(
                () => setConfirming(null),
              )
            }
            type="button"
          >
            Quitar
          </button>
        </span>
      );
    }
    if (editing === member.id) {
      return (
        <span className="flex shrink-0 items-center gap-3">
          <Select
            aria-label={`Rol de ${member.name}`}
            disabled={busy}
            onChange={(event) => {
              const role = event.target.value;
              void run(() =>
                changeMemberRole({ data: { organizationId, memberId: member.id, role } }),
              );
            }}
            value={member.role}
          >
            {rolesFor(team!.role).map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </Select>
          <button
            className={GHOST}
            disabled={busy}
            onClick={() => {
              setEditing(null);
              setConfirming(member.id);
            }}
            type="button"
          >
            Quitar
          </button>
          <button className={GHOST} onClick={() => setEditing(null)} type="button">
            Listo
          </button>
        </span>
      );
    }
    return (
      <span className="flex shrink-0 items-center gap-3">
        <RoleBadge role={member.role} />
        <button
          aria-label={`Editar a ${member.name}`}
          className={GHOST}
          disabled={busy}
          onClick={() => setEditing(member.id)}
          type="button"
        >
          Editar
        </button>
      </span>
    );
  }

  const leaving = confirming === "leave";
  const soleOwner = team.role.includes("owner") && owners <= 1;

  return (
    <Page title="Configuración">
      <Section note={ROLE_LABELS[team.role] ?? team.role} title="General">
        {manages ? (
          <form className="flex gap-2" onSubmit={rename}>
            <input
              aria-label="Nombre del equipo"
              className={`${FIELD} flex-1`}
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nombre del equipo"
              value={name}
            />
            <button
              className={SECONDARY}
              disabled={busy || !name.trim() || name.trim() === team.name}
              type="submit"
            >
              Guardar
            </button>
          </form>
        ) : (
          <p>{team.name}</p>
        )}
      </Section>

      <Section
        note={`${people.members.length} ${people.members.length === 1 ? "persona" : "personas"}`}
        title="Miembros"
      >
        <ul className={LIST}>
          {manages && (
            <li>
              {inviting ? (
                <form className="flex flex-wrap gap-2 py-3" onSubmit={invite}>
                  <input
                    aria-label="Correo"
                    autoFocus
                    className={`${FIELD} min-w-48 flex-1`}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="nombre@empresa.com"
                    required
                    type="email"
                    value={email}
                  />
                  <Select
                    aria-label="Rol"
                    onChange={(event) => setInviteRole(event.target.value)}
                    value={inviteRole}
                  >
                    {rolesFor(team.role).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <button className={GHOST} onClick={() => setInviting(false)} type="button">
                    Cancelar
                  </button>
                  <button className={PRIMARY} disabled={busy || !email.trim()} type="submit">
                    Invitar
                  </button>
                </form>
              ) : (
                <AddRow
                  disabled={busy}
                  label="Invitar a alguien"
                  onClick={() => {
                    setSentTo(null);
                    setInviting(true);
                  }}
                />
              )}
            </li>
          )}
          {people.members.map((member) => (
            <li className={LIST_ROW} key={member.id}>
              <div className="flex min-w-0 items-center gap-3">
                <PersonAvatar person={member} />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {member.name}
                    {member.userId === dashboard.user.id && (
                      <span className="text-muted"> (tú)</span>
                    )}
                  </span>
                  <span className="truncate text-[13px] text-muted">{member.email}</span>
                </div>
              </div>
              {memberActions(member)}
            </li>
          ))}
        </ul>
        {sentTo && <p className="text-[13px] text-muted">Invitación enviada a {sentTo}.</p>}
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </Section>

      <Section title="Invitaciones">
        {people.invitations.length === 0 ? (
          <p className="text-muted">Las personas que invites aparecen aquí hasta que se unan.</p>
        ) : (
          <ul className={LIST}>
            {people.invitations.map((invitation) => (
              <li className={LIST_ROW} key={invitation.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar pending person={invitation} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{invitation.email}</span>
                    <span className="truncate text-[13px] text-muted">
                      Vence el {dateFormat.format(new Date(invitation.expiresAt))}
                    </span>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-3">
                  <RoleBadge role={invitation.role} />
                  {manages &&
                    (confirming === invitation.id ? (
                      <>
                        <button className={GHOST} onClick={() => setConfirming(null)} type="button">
                          Cancelar
                        </button>
                        <button
                          className={PRIMARY}
                          disabled={busy}
                          onClick={() =>
                            void run(() => cancelInvitation({ data: invitation.id })).then(() =>
                              setConfirming(null),
                            )
                          }
                          type="button"
                        >
                          Revocar
                        </button>
                      </>
                    ) : (
                      <button
                        className={GHOST}
                        disabled={busy}
                        onClick={() => setConfirming(invitation.id)}
                        type="button"
                      >
                        Revocar
                      </button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!team.personal && (
        <Section title="Salir del equipo">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-muted">
              {soleOwner
                ? "Eres su único propietario: nombra a otro antes de salir."
                : "Dejas de ver sus claves y su uso. Las claves que creaste siguen siendo del equipo."}
            </p>
            {leaving ? (
              <span className="flex shrink-0 items-center gap-3">
                <button className={GHOST} onClick={() => setConfirming(null)} type="button">
                  Cancelar
                </button>
                <button
                  className={PRIMARY}
                  disabled={busy}
                  onClick={() => void run(() => leaveTeam({ data: organizationId }))}
                  type="button"
                >
                  Salir
                </button>
              </span>
            ) : (
              <button
                className={SECONDARY}
                disabled={busy || soleOwner}
                onClick={() => setConfirming("leave")}
                type="button"
              >
                Salir
              </button>
            )}
          </div>
        </Section>
      )}
    </Page>
  );
}
