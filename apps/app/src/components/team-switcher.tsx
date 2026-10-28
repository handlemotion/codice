import {
  IconArrowUpRight,
  IconCheckmark1Small,
  IconPlusSmall,
  IconSettingsGear1,
} from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import { Link, getRouteApi, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { createTeam, setActiveTeam } from "../server/functions";
import { FIELD, PRIMARY, ROLE_LABELS, SECONDARY } from "./ui";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const dashboardRoute = getRouteApi("/_dashboard");

/** A team's mark: its initial in a hairline square (a person's is a circle). */
function TeamMark({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-[2px] border border-current/40 text-[11px] leading-none"
      style={{ width: size, height: size }}
    >
      {name.trim().charAt(0).toLocaleUpperCase("es")}
    </span>
  );
}

/** "Crear un equipo": a dialog that names it; the new team becomes the active one. */
function CreateTeam({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createTeam({ data: name });
      await router.invalidate();
      setName("");
      onOpenChange(false);
    } catch {
      setError("No se pudo completar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(event) => void create(event)}>
          <DialogHeader>
            <DialogTitle>Crear un equipo</DialogTitle>
          </DialogHeader>
          <input
            aria-label="Nombre del equipo"
            autoFocus
            className={FIELD}
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nombre, por ejemplo tu empresa"
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
              Crear
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The rail's top: the active team's mark, opening the user's teams to switch between, creating
 * one, the team's settings and the site. `hint` wraps the trigger in the rail's tooltip.
 */
export function TeamSwitcher({
  className,
  hint,
}: {
  className: string;
  hint: (label: string, trigger: ReactNode) => ReactNode;
}) {
  const { dashboard } = dashboardRoute.useRouteContext();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const active = dashboard.team;

  async function switchTo(teamId: string) {
    if (teamId === active?.id) return;
    await setActiveTeam({ data: teamId });
    await router.invalidate();
  }

  return (
    <>
      <DropdownMenu>
        {hint(
          active?.name ?? "Equipos",
          <DropdownMenuTrigger aria-label="Cambiar de equipo" className={className}>
            <TeamMark name={active?.name ?? "+"} />
          </DropdownMenuTrigger>,
        )}
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuLabel>Equipos</DropdownMenuLabel>
          <DropdownMenuGroup>
            {dashboard.teams.map((team) => (
              <DropdownMenuItem key={team.id} onSelect={() => void switchTo(team.id)}>
                <TeamMark name={team.name} />
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
                <span className="text-muted">{ROLE_LABELS[team.role] ?? team.role}</span>
                <span className="grid w-4 place-items-center">
                  {team.id === active?.id && <IconCheckmark1Small size={16} />}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuItem className="text-muted focus:text-fg" onSelect={() => setCreating(true)}>
            <span className="grid size-5 place-items-center">
              <IconPlusSmall size={16} />
            </span>
            Crear un equipo
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {active && (
            <DropdownMenuItem asChild>
              <Link to="/settings">
                <span className="grid size-5 place-items-center text-muted">
                  <IconSettingsGear1 size={16} />
                </span>
                Configuración del equipo
              </Link>
            </DropdownMenuItem>
          )}
          {/* `/?site` is the edge's switch to the marketing site for a signed-in visitor. */}
          <DropdownMenuItem asChild>
            <a href="/?site">
              <span className="grid size-5 place-items-center text-muted">
                <IconArrowUpRight size={16} />
              </span>
              Sitio de Códice
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateTeam onOpenChange={setCreating} open={creating} />
    </>
  );
}
