// FILE: _chat.agents.tsx
// Purpose: Registers the agent automation dashboard under the shared chat shell.
// Layer: Route
// Exports: Route

import { createFileRoute } from "@tanstack/react-router";
import { AgentLibrary } from "~/components/AgentLibrary";

export const Route = createFileRoute("/_chat/agents")({
  component: AgentLibrary,
});
