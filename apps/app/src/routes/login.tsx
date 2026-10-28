import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient, inAuthorization } from "../auth-client";
import { Mark } from "../brand/mark";
import { GHOST, PRIMARY, SECONDARY } from "../components/ui";
import type { SocialProvider } from "../server/auth";
import { getDashboard, getSignInProviders } from "../server/functions";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar · Códice" }] }),
  beforeLoad: async () => {
    if (await getDashboard()) throw redirect({ to: "/" });
  },
  loader: async () => ({ providers: await getSignInProviders() }),
  component: Login,
});

// On the ground, with no card: white by day, a hairline at night, like an island.
const FIELD =
  "h-8 w-full rounded-[2px] border border-edge bg-island px-3 outline-none placeholder:text-muted focus:border-fg disabled:text-muted";
const WIDE = "w-full";

function GoogleLogo() {
  return (
    <svg aria-hidden className="size-4" viewBox="0 0 24 24">
      <path
        d="M21.35 11.1H12v3.2h5.35c-.5 2.4-2.6 3.9-5.35 3.9a6.2 6.2 0 1 1 0-12.4c1.55 0 2.95.55 4.05 1.5l2.4-2.4A9.6 9.6 0 0 0 12 2.4a9.6 9.6 0 1 0 0 19.2c5.55 0 9.6-3.9 9.6-9.6 0-.65-.1-1.3-.25-1.9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function GitHubLogo() {
  return (
    <svg aria-hidden className="size-4" viewBox="0 0 24 24">
      <path
        d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}

const PROVIDERS: Record<SocialProvider, { label: string; Logo: () => React.JSX.Element }> = {
  google: { label: "Continuar con Google", Logo: GoogleLogo },
  github: { label: "Continuar con GitHub", Logo: GitHubLogo },
};

/**
 * Sign-in: the mark, a title and its line, then the email code and the social buttons straight on
 * the ground, in one narrow column. During an MCP client's authorization it resumes it.
 */
function Login() {
  const { providers } = Route.useLoaderData();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: unknown }>, failure: string) {
    setBusy(true);
    setError(null);
    const { error: refused } = await action();
    setBusy(false);
    if (refused) setError(failure);
    return !refused;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sent) {
      const ok = await run(
        () => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }),
        "No pude enviar el código. Revisa el correo e intenta de nuevo.",
      );
      if (ok) setSent(true);
      return;
    }
    const ok = await run(
      () => authClient.signIn.emailOtp({ email, otp }),
      "El código no es válido o ya venció.",
    );
    // During an MCP client's authorization, the sign-in answers with the next step (consent
    // or the client's redirect) and the auth client follows it.
    if (ok && !inAuthorization()) await navigate({ to: "/" });
  }

  function social(provider: SocialProvider) {
    void run(
      () => authClient.signIn.social({ provider, callbackURL: "/" }),
      "No se pudo entrar. Intenta de nuevo.",
    );
  }

  function restart() {
    setSent(false);
    setOtp("");
    setError(null);
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[20rem] flex-col justify-center gap-6 px-4 py-16">
      <a
        aria-label="Sitio de Códice"
        className="grid size-8 place-items-center rounded-[4px] bg-electric text-white"
        href="/?site"
      >
        <Mark className="size-5" radius={9} strokeWidth={1.5} />
      </a>
      <h1 className="text-[20px] leading-snug">Entrar a Códice</h1>

      <div className="flex flex-col gap-2">
        <form className="flex flex-col gap-2" onSubmit={submit}>
          {sent ? (
            <input
              aria-label="Código"
              autoComplete="one-time-code"
              autoFocus
              className={`${FIELD} tracking-[0.2em] placeholder:tracking-normal`}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
              placeholder="Código"
              required
              value={otp}
            />
          ) : (
            <input
              aria-label="Correo"
              autoComplete="email"
              autoFocus
              className={FIELD}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@empresa.com"
              required
              type="email"
              value={email}
            />
          )}
          <button className={`${PRIMARY} ${WIDE}`} disabled={busy} type="submit">
            {sent ? "Entrar" : "Continuar con correo"}
          </button>
        </form>

        {sent ? (
          <p className="flex flex-wrap gap-x-2 text-[13px] text-muted">
            Código enviado a {email}.
            <button className={GHOST} onClick={restart} type="button">
              Cambiar
            </button>
          </p>
        ) : (
          providers.map((provider) => {
            const { label, Logo } = PROVIDERS[provider];
            return (
              <button
                className={`${SECONDARY} ${WIDE} border-edge bg-island`}
                disabled={busy}
                key={provider}
                onClick={() => social(provider)}
                type="button"
              >
                <Logo />
                {label}
              </button>
            );
          })
        )}
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </div>
    </main>
  );
}
