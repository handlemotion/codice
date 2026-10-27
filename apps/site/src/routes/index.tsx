import { createFileRoute } from "@tanstack/react-router";

import { DemoChat } from "../components/demo-chat";

export const Route = createFileRoute("/")({ component: Home });

const EXAMPLE = `curl https://codice.io/v1/search?q=uso+del+cfdi

{ "data": { "results": [ { "passage": "…", "source": "anexo-20", … } ] } }`;

// The dashboard lives on the same host; `/login` and `/keys` are its routes (apps/edge).
function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-24">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium tracking-wide text-stone-500 uppercase">Códice</p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Mexican tax and customs rules, searchable over HTTP and MCP.
        </h1>
        <p className="text-lg text-pretty text-stone-600">
          The SAT&apos;s CFDI 4.0, Pagos 2.0, catalogs, error codes and the Resolución Miscelánea
          Fiscal, quoted verbatim with their source and validity dates.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <a
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            href="/keys"
          >
            Get an API key
          </a>
          <a
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-100"
            href="/login"
          >
            Sign in
          </a>
        </div>
      </header>
      <DemoChat />
      <pre className="overflow-x-auto rounded-lg bg-stone-900 p-5 text-sm leading-relaxed text-stone-100">
        <code>{EXAMPLE}</code>
      </pre>
    </main>
  );
}
