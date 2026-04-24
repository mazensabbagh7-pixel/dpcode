/**
 * Agent Automation contracts.
 *
 * Saved "agent" definitions bundle a provider + model + system prompt append
 * + tool allowlist + task template. Users create them in the Agents UI and
 * invoke them with "Run Now" (MVP) or on a schedule (V1).
 */

import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";
import { ModelSelection, ProviderKind, ThreadEnvironmentMode } from "./orchestration";

export const AgentRunTrigger = Schema.Literals(["manual", "scheduled"]);
export type AgentRunTrigger = typeof AgentRunTrigger.Type;

export const AgentRunStatus = Schema.Literals([
  "queued",
  "running",
  "complete",
  "failed",
  "cancelled",
]);
export type AgentRunStatus = typeof AgentRunStatus.Type;

/**
 * A saved agent configuration. Persisted in sqlite table `agent_definitions`.
 */
export const AgentDefinition = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  provider: ProviderKind,
  modelSelection: ModelSelection,
  /** Appended to the provider's base system prompt on every run. */
  systemPrompt: Schema.optional(Schema.String),
  /** Task prompt sent as the first user message. Supports {{variable}} substitution. */
  taskTemplate: TrimmedNonEmptyString,
  /** MCP tool names this agent is allowed to call. Empty = inherit session defaults. */
  toolAllowlist: Schema.Array(Schema.String),
  /** Working directory for the spawned thread. Null = inherit from project default. */
  cwd: Schema.optional(TrimmedNonEmptyString),
  envMode: ThreadEnvironmentMode,
  /** Cron expression for scheduled runs. Null = manual-only. Only honored in V1+. */
  schedule: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  lastRunAt: Schema.optional(Schema.Number),
});
export type AgentDefinition = typeof AgentDefinition.Type;

/**
 * A single invocation of an agent. Persisted in sqlite table `agent_runs`.
 * Each run spawns its own thread and stores the thread id for navigation.
 */
export const AgentRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  agentId: TrimmedNonEmptyString,
  threadId: TrimmedNonEmptyString,
  trigger: AgentRunTrigger,
  status: AgentRunStatus,
  startedAt: Schema.Number,
  endedAt: Schema.optional(Schema.Number),
  errorMessage: Schema.optional(Schema.String),
  /** The task_template with all {{variables}} substituted. This is what was actually sent. */
  renderedTask: Schema.String,
});
export type AgentRun = typeof AgentRun.Type;

/* ---------- WS command payloads ---------- */

export const AgentCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  provider: ProviderKind,
  modelSelection: ModelSelection,
  systemPrompt: Schema.optional(Schema.String),
  taskTemplate: TrimmedNonEmptyString,
  toolAllowlist: Schema.Array(Schema.String),
  cwd: Schema.optional(TrimmedNonEmptyString),
  envMode: ThreadEnvironmentMode,
  schedule: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean,
});
export type AgentCreateInput = typeof AgentCreateInput.Type;

export const AgentUpdateInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  description: Schema.optional(Schema.String),
  provider: Schema.optional(ProviderKind),
  modelSelection: Schema.optional(ModelSelection),
  systemPrompt: Schema.optional(Schema.String),
  taskTemplate: Schema.optional(TrimmedNonEmptyString),
  toolAllowlist: Schema.optional(Schema.Array(Schema.String)),
  cwd: Schema.optional(TrimmedNonEmptyString),
  envMode: Schema.optional(ThreadEnvironmentMode),
  schedule: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.optional(Schema.Boolean),
});
export type AgentUpdateInput = typeof AgentUpdateInput.Type;

export const AgentDeleteInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type AgentDeleteInput = typeof AgentDeleteInput.Type;

export const AgentRunNowInput = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  /** Values for {{variable}} substitution in the task_template. */
  variables: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type AgentRunNowInput = typeof AgentRunNowInput.Type;

export const AgentRunNowResult = Schema.Struct({
  runId: TrimmedNonEmptyString,
  threadId: TrimmedNonEmptyString,
});
export type AgentRunNowResult = typeof AgentRunNowResult.Type;

export const AgentListRunsInput = Schema.Struct({
  agentId: TrimmedNonEmptyString,
  limit: Schema.optional(Schema.Number),
});
export type AgentListRunsInput = typeof AgentListRunsInput.Type;

/* ---------- WS method names ---------- */

export const AGENT_WS_METHODS = {
  list: "agents.list",
  create: "agents.create",
  update: "agents.update",
  delete: "agents.delete",
  runNow: "agents.runNow",
  listRuns: "agents.listRuns",
} as const;
