/**
 * AgentRepository — Service for saved agent definitions and their run history.
 *
 * Persists the Agent Automation feature's two domain aggregates:
 *   - AgentDefinition (the saved config — provider/model/prompt/tools/etc.)
 *   - AgentRun       (a single invocation of an agent, linked to a thread)
 *
 * Used by the WS handlers in `wsServer.ts` for CRUD and run-now flows.
 */

import { AgentDefinition, AgentRun, AgentRunStatus } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const GetAgentDefinitionInput = Schema.Struct({
  id: Schema.String,
});
export type GetAgentDefinitionInput = typeof GetAgentDefinitionInput.Type;

export const DeleteAgentDefinitionInput = Schema.Struct({
  id: Schema.String,
});
export type DeleteAgentDefinitionInput = typeof DeleteAgentDefinitionInput.Type;

export const ListAgentRunsInput = Schema.Struct({
  agentId: Schema.String,
  limit: Schema.optional(Schema.Number),
});
export type ListAgentRunsInput = typeof ListAgentRunsInput.Type;

export const FinishAgentRunsForThreadInput = Schema.Struct({
  threadId: Schema.String,
  status: AgentRunStatus,
  endedAt: Schema.Number,
  errorMessage: Schema.optional(Schema.NullOr(Schema.String)),
});
export type FinishAgentRunsForThreadInput = typeof FinishAgentRunsForThreadInput.Type;

/**
 * AgentRepositoryShape — CRUD surface for saved agents + their runs.
 */
export interface AgentRepositoryShape {
  /** Insert or replace an agent definition row (upsert by id). */
  readonly upsert: (row: AgentDefinition) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Read a single agent definition by id. */
  readonly getById: (
    input: GetAgentDefinitionInput,
  ) => Effect.Effect<Option.Option<AgentDefinition>, ProjectionRepositoryError>;

  /** List all agent definitions. Order: most recently updated first. */
  readonly listAll: () => Effect.Effect<ReadonlyArray<AgentDefinition>, ProjectionRepositoryError>;

  /** Delete an agent definition by id. Associated runs cascade via FK. */
  readonly deleteById: (
    input: DeleteAgentDefinitionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Insert or replace an agent run row (upsert by id). */
  readonly upsertRun: (row: AgentRun) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * List runs for an agent, newest first.
   *
   * Defaults to 50 most recent when `limit` is not provided.
   */
  readonly listRunsForAgent: (
    input: ListAgentRunsInput,
  ) => Effect.Effect<ReadonlyArray<AgentRun>, ProjectionRepositoryError>;

  /** Mark any non-terminal runs for a thread as complete/failed/cancelled. */
  readonly finishRunsForThread: (
    input: FinishAgentRunsForThreadInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * AgentRepository — Service tag for saved-agent persistence.
 */
export class AgentRepository extends ServiceMap.Service<AgentRepository, AgentRepositoryShape>()(
  "t3/persistence/Services/Agents/AgentRepository",
) {}
