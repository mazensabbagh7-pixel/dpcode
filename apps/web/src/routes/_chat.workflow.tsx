// FILE: _chat.workflow.tsx
// Purpose: Registers the workflow operations hub under the shared chat shell.
// Layer: Route
// Exports: Route

import { createFileRoute } from "@tanstack/react-router";
import { WorkflowHub } from "~/components/WorkflowHub";

export const Route = createFileRoute("/_chat/workflow")({
  component: WorkflowHub,
});
