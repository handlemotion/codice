import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { createAuth } from "../../../server/auth";

const handle = ({ request }: { request: Request }) => createAuth(env).handler(request);

/** Better Auth: sign-in by email code, Google and GitHub; sessions, teams and keys. */
export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
