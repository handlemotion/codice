import { createFileRoute } from "@tanstack/react-router";

import { Chat } from "../../chat";

export const Route = createFileRoute("/_dashboard/")({
  head: () => ({ meta: [{ title: "Chat · Códice" }] }),
  component: Chat,
});
