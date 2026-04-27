/**
 * AgentRepositoryLive — sqlite-backed implementation of AgentRepository.
 *
 * Mirrors the ProjectionProjects layer pattern:
 *   - mapFields(Struct.assign(...)) to override JSON/boolean columns in the row schema
 *   - SqlSchema.void for writes, findOneOption for single reads, findAll for lists
 *   - Errors mapped through toPersistenceSqlError
 */

import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema, Struct } from "effect";
import * as SchemaGetter from "effect/SchemaGetter";

import { AgentDefinition, AgentRun, ModelSelection } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  AgentRepository,
  type AgentRepositoryShape,
  DeleteAgentDefinitionInput,
  FinishAgentRunsForThreadInput,
  GetAgentDefinitionInput,
  ListAgentRunsInput,
} from "../Services/Agents.ts";

const SqliteBoolean = Schema.Number.pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value !== 0),
    encode: SchemaGetter.transform((value) => (value ? 1 : 0)),
  }),
);

const AgentDefinitionDbRow = AgentDefinition.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
    toolAllowlist: Schema.fromJsonString(Schema.Array(Schema.String)),
    enabled: SqliteBoolean,
  }),
);
type AgentDefinitionDbRow = typeof AgentDefinitionDbRow.Type;

const makeAgentRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertAgentDefinitionRow = SqlSchema.void({
    Request: AgentDefinition,
    execute: (row) =>
      sql`
        INSERT INTO agent_definitions (
          id,
          project_id,
          name,
          description,
          provider,
          model_selection,
          system_prompt,
          task_template,
          tool_allowlist,
          cwd,
          env_mode,
          schedule,
          enabled,
          created_at,
          updated_at,
          last_run_at
        )
        VALUES (
          ${row.id},
          ${row.projectId},
          ${row.name},
          ${row.description ?? null},
          ${row.provider},
          ${JSON.stringify(row.modelSelection)},
          ${row.systemPrompt ?? null},
          ${row.taskTemplate},
          ${JSON.stringify(row.toolAllowlist)},
          ${row.cwd ?? null},
          ${row.envMode},
          ${row.schedule ?? null},
          ${row.enabled ? 1 : 0},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.lastRunAt ?? null}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          project_id = excluded.project_id,
          name = excluded.name,
          description = excluded.description,
          provider = excluded.provider,
          model_selection = excluded.model_selection,
          system_prompt = excluded.system_prompt,
          task_template = excluded.task_template,
          tool_allowlist = excluded.tool_allowlist,
          cwd = excluded.cwd,
          env_mode = excluded.env_mode,
          schedule = excluded.schedule,
          enabled = excluded.enabled,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          last_run_at = excluded.last_run_at
      `,
  });

  const getAgentDefinitionRow = SqlSchema.findOneOption({
    Request: GetAgentDefinitionInput,
    Result: AgentDefinitionDbRow,
    execute: ({ id }) =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          name,
          description,
          provider,
          model_selection AS "modelSelection",
          system_prompt AS "systemPrompt",
          task_template AS "taskTemplate",
          tool_allowlist AS "toolAllowlist",
          cwd,
          env_mode AS "envMode",
          schedule,
          enabled,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt"
        FROM agent_definitions
        WHERE id = ${id}
      `,
  });

  const listAgentDefinitionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: AgentDefinitionDbRow,
    execute: () =>
      sql`
        SELECT
          id,
          project_id AS "projectId",
          name,
          description,
          provider,
          model_selection AS "modelSelection",
          system_prompt AS "systemPrompt",
          task_template AS "taskTemplate",
          tool_allowlist AS "toolAllowlist",
          cwd,
          env_mode AS "envMode",
          schedule,
          enabled,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_run_at AS "lastRunAt"
        FROM agent_definitions
        ORDER BY updated_at DESC, id ASC
      `,
  });

  const deleteAgentDefinitionRow = SqlSchema.void({
    Request: DeleteAgentDefinitionInput,
    execute: ({ id }) =>
      sql`
        DELETE FROM agent_definitions
        WHERE id = ${id}
      `,
  });

  const upsertAgentRunRow = SqlSchema.void({
    Request: AgentRun,
    execute: (row) =>
      sql`
        INSERT INTO agent_runs (
          id,
          agent_id,
          thread_id,
          trigger,
          status,
          started_at,
          ended_at,
          error_message,
          rendered_task
        )
        VALUES (
          ${row.id},
          ${row.agentId},
          ${row.threadId},
          ${row.trigger},
          ${row.status},
          ${row.startedAt},
          ${row.endedAt ?? null},
          ${row.errorMessage ?? null},
          ${row.renderedTask}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          agent_id = excluded.agent_id,
          thread_id = excluded.thread_id,
          trigger = excluded.trigger,
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          error_message = excluded.error_message,
          rendered_task = excluded.rendered_task
      `,
  });

  const listAgentRunRows = SqlSchema.findAll({
    Request: ListAgentRunsInput,
    Result: AgentRun,
    execute: ({ agentId, limit }) =>
      sql`
        SELECT
          id,
          agent_id AS "agentId",
          thread_id AS "threadId",
          trigger,
          status,
          started_at AS "startedAt",
          ended_at AS "endedAt",
          error_message AS "errorMessage",
          rendered_task AS "renderedTask"
        FROM agent_runs
        WHERE agent_id = ${agentId}
        ORDER BY started_at DESC, id ASC
        LIMIT ${limit ?? 50}
      `,
  });

  const finishAgentRunsForThreadRows = SqlSchema.void({
    Request: FinishAgentRunsForThreadInput,
    execute: ({ threadId, status, endedAt, errorMessage }) =>
      sql`
        UPDATE agent_runs
        SET
          status = ${status},
          ended_at = ${endedAt},
          error_message = ${errorMessage ?? null}
        WHERE thread_id = ${threadId}
          AND status IN ('queued', 'running')
      `,
  });

  const upsert: AgentRepositoryShape["upsert"] = (row) =>
    upsertAgentDefinitionRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.upsert:query")),
    );

  const getById: AgentRepositoryShape["getById"] = (input) =>
    getAgentDefinitionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.getById:query")),
    );

  const listAll: AgentRepositoryShape["listAll"] = () =>
    listAgentDefinitionRows().pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.listAll:query")),
    );

  const deleteById: AgentRepositoryShape["deleteById"] = (input) =>
    deleteAgentDefinitionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.deleteById:query")),
    );

  const upsertRun: AgentRepositoryShape["upsertRun"] = (row) =>
    upsertAgentRunRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.upsertRun:query")),
    );

  const listRunsForAgent: AgentRepositoryShape["listRunsForAgent"] = (input) =>
    listAgentRunRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.listRunsForAgent:query")),
    );

  const finishRunsForThread: AgentRepositoryShape["finishRunsForThread"] = (input) =>
    finishAgentRunsForThreadRows(input).pipe(
      Effect.mapError(toPersistenceSqlError("AgentRepository.finishRunsForThread:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
    upsertRun,
    listRunsForAgent,
    finishRunsForThread,
  } satisfies AgentRepositoryShape;
});

export const AgentRepositoryLive = Layer.effect(AgentRepository, makeAgentRepository);
