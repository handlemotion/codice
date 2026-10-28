import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { authClient, inAuthorization } from "../auth-client";
import type { SocialProvider } from "../server/auth";
import { getDashboard, getSignInProviders } from "../server/functions";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    if (await getDashboard()) throw redirect({ to: "/" });
  },
  loader: async () => ({ providers: await getSignInProviders() }),
  component: Login,
});

const PROVIDER_LABELS: Record<SocialProvider, string> = {
  google: "Continue with Google",
  github: "Continue with GitHub",
};

const button =
  "rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-100 disabled:opacity-50";

function Login() {
  const { providers } = Route.useLoaderData();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<{ error: { message?: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: failure } = await action();
    setBusy(false);
    if (failure) setError(failure.message ?? "Something went wrong");
    return !failure;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!sent) {
      if (await run(() => authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }))) {
        setSent(true);
      }
      return;
    }
    if (await run(() => authClient.signIn.emailOtp({ email, otp }))) {
      // During an MCP client's authorization, the sign-in answers with the next step (consent
      // or the client's redirect) and the auth client follows it.
      if (!inAuthorization()) await navigate({ to: "/" });
    }
  }

  function social(provider: SocialProvider) {
    void run(() => authClient.signIn.social({ provider, callbackURL: "/" }));
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Códice</h1>
      <form className="flex flex-col gap-2" onSubmit={submit}>
        <input
          aria-label="Email"
          autoComplete="email"
          className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"
          disabled={sent}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
          required
          type="email"
          value={email}
        />
        {sent ? (
          <input
            aria-label="Code"
            autoComplete="one-time-code"
            className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm tracking-widest"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setOtp(event.target.value)}
            placeholder="6-digit code"
            required
            value={otp}
          />
        ) : null}
        <button className={button} disabled={busy} type="submit">
          {sent ? "Sign in" : "Email me a code"}
        </button>
        {sent ? (
          <p className="text-sm text-stone-500">
            We sent a code to {email}. It expires in 10 minutes.
          </p>
        ) : null}
      </form>
      {providers.length > 0 ? <p className="text-center text-xs text-stone-500">or</p> : null}
      {providers.map((provider) => (
        <button
          className={button}
          disabled={busy}
          key={provider}
          onClick={() => social(provider)}
          type="button"
        >
          {PROVIDER_LABELS[provider]}
        </button>
      ))}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <a className="text-sm text-stone-500 underline" href="/?site">
        Back to the website
      </a>
    </main>
  );
}
