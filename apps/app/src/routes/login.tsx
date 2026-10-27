import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Códice</h1>
      <p className="text-stone-600">Sign-in is not available yet.</p>
      <a className="text-sm text-stone-500 underline" href="/?site">
        Back to the website
      </a>
    </main>
  );
}
