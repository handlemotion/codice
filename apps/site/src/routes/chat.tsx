import { createFileRoute } from "@tanstack/react-router";

import { Chat } from "../chat";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Pregúntale a Códice" }] }),
  component: Chat,
});
