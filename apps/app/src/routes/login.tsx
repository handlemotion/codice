import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient } from "../auth-client";
import { Mark } from "../brand/mark";
import { FIELD, ISLAND, PRIMARY, SECONDARY } from "../components/ui";
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

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: "Continuar con Google",
  github: "Continuar con GitHub",
};

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
    if (ok) await navigate({ to: "/" });
  }

  function social(provider: SocialProvider) {
    void run(
      () => authClient.signIn.social({ provider, callbackURL: "/" }),
      "No se pudo entrar. Intenta de nuevo.",
    );
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-[24rem] flex-col justify-center gap-6 px-4 py-16">
      <a aria-label="Sitio de Códice" className="flex w-fit items-center gap-2.5" href="/?site">
        <Mark className="size-5" strokeWidth={1.5} />
        <span className="[text-box:trim-both_cap_alphabetic]">Códice</span>
      </a>
      <div className={`${ISLAND} flex flex-col gap-4 p-6`}>
        <h1 className="font-bold">Entrar</h1>
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <input
            aria-label="Correo"
            autoComplete="email"
            className={FIELD}
            disabled={sent}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@empresa.com"
            required
            type="email"
            value={email}
          />
          {sent && (
            <input
              aria-label="Código"
              autoComplete="one-time-code"
              autoFocus
              className={`${FIELD} font-mono tracking-[0.3em]`}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setOtp(event.target.value)}
              placeholder="000000"
              required
              value={otp}
            />
          )}
          <button className={PRIMARY} disabled={busy} type="submit">
            {sent ? "Entrar" : "Enviarme un código"}
          </button>
        </form>
        {sent && (
          <p className="text-[13px] text-muted">
            Enviamos un código a {email}. Vence en 10 minutos.
          </p>
        )}
        {providers.length > 0 && (
          <div className="flex flex-col gap-2">
            {providers.map((provider) => (
              <button
                className={SECONDARY}
                disabled={busy}
                key={provider}
                onClick={() => social(provider)}
                type="button"
              >
                {PROVIDER_LABELS[provider]}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-[13px] text-muted">{error}</p>}
      </div>
    </main>
  );
}
