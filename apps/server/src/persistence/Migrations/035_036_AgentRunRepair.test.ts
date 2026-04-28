import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("035/036 chat and agent-run repair migrations", (it) => {
  it.effect("normalizes terminal turns and reconciles agent runs from latest state only", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 34 });

      yield* sql`
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
          'agent-1',
          'project-1',
          'Agent',
          NULL,
          'codex',
          '{"provider":"codex","model":"gpt-5-codex"}',
          NULL,
          'Do it',
          '[]',
          NULL,
          'local',
          NULL,
          1,
          1770000000000,
          1770000000000,
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          kind,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          'project-1',
          'chat',
          'Home',
          '/tmp/project-1',
          '{"provider":"codex","model":"gpt-5-codex"}',
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode
        )
        VALUES
          (
            'thread-terminal-error',
            'project-1',
            'Terminal error thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            NULL,
            NULL,
            'turn-terminal-error',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:10.000Z',
            NULL,
            'full-access',
            'default'
          ),
          (
            'thread-latest-complete',
            'project-1',
            'Latest complete thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            NULL,
            NULL,
            'turn-complete-new',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:20.000Z',
            NULL,
            'full-access',
            'default'
          ),
          (
            'thread-still-running',
            'project-1',
            'Still running thread',
            '{"provider":"codex","model":"gpt-5-codex"}',
            NULL,
            NULL,
            'turn-running-new',
            '2026-01-01T00:00:00.000Z',
            '2026-01-01T00:00:30.000Z',
            NULL,
            'full-access',
            'default'
          )
      `;

      yield* sql`
        INSERT INTO projection_thread_sessions (
          thread_id,
          status,
          provider_name,
          provider_session_id,
          provider_thread_id,
          active_turn_id,
          last_error,
          updated_at,
          runtime_mode
        )
        VALUES
          (
            'thread-terminal-error',
            'error',
            'codex',
            NULL,
            NULL,
            'turn-terminal-error',
            'boom',
            '2026-01-01T00:00:10.000Z',
            'full-access'
          ),
          (
            'thread-latest-complete',
            'ready',
            'codex',
            NULL,
            NULL,
            NULL,
            NULL,
            '2026-01-01T00:00:20.000Z',
            'full-access'
          ),
          (
            'thread-still-running',
            'running',
            'codex',
            NULL,
            NULL,
            'turn-running-new',
            NULL,
            '2026-01-01T00:00:30.000Z',
            'full-access'
          )
      `;

      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES
          (
            'thread-terminal-error',
            'turn-terminal-error',
            NULL,
            NULL,
            'pending',
            '2026-01-01T00:00:05.000Z',
            '2026-01-01T00:00:05.000Z',
            NULL,
            NULL,
            NULL,
            NULL,
            '[]'
          ),
          (
            'thread-latest-complete',
            'turn-error-old',
            NULL,
            NULL,
            'error',
            '2026-01-01T00:00:05.000Z',
            '2026-01-01T00:00:05.000Z',
            '2026-01-01T00:00:06.000Z',
            NULL,
            NULL,
            NULL,
            '[]'
          ),
          (
            'thread-latest-complete',
            'turn-complete-new',
            NULL,
            NULL,
            'completed',
            '2026-01-01T00:00:15.000Z',
            '2026-01-01T00:00:15.000Z',
            '2026-01-01T00:00:20.000Z',
            NULL,
            NULL,
            NULL,
            '[]'
          ),
          (
            'thread-still-running',
            'turn-complete-old',
            NULL,
            NULL,
            'completed',
            '2026-01-01T00:00:05.000Z',
            '2026-01-01T00:00:05.000Z',
            '2026-01-01T00:00:06.000Z',
            NULL,
            NULL,
            NULL,
            '[]'
          ),
          (
            'thread-still-running',
            'turn-running-new',
            NULL,
            NULL,
            'running',
            '2026-01-01T00:00:25.000Z',
            '2026-01-01T00:00:25.000Z',
            NULL,
            NULL,
            NULL,
            NULL,
            '[]'
          )
      `;

      yield* sql`
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
        VALUES
          (
            'run-latest-complete',
            'agent-1',
            'thread-latest-complete',
            'manual',
            'running',
            1770000000000,
            NULL,
            NULL,
            'Task'
          ),
          (
            'run-still-running',
            'agent-1',
            'thread-still-running',
            'manual',
            'running',
            1770000000000,
            NULL,
            NULL,
            'Task'
          )
      `;

      yield* runMigrations({ toMigrationInclusive: 35 });

      const terminalRows = yield* sql<{
        readonly state: string;
        readonly completedAt: string | null;
        readonly activeTurnId: string | null;
      }>`
        SELECT
          projection_turns.state,
          projection_turns.completed_at AS "completedAt",
          projection_thread_sessions.active_turn_id AS "activeTurnId"
        FROM projection_turns
        INNER JOIN projection_thread_sessions
          ON projection_thread_sessions.thread_id = projection_turns.thread_id
        WHERE projection_turns.thread_id = 'thread-terminal-error'
      `;
      assert.deepEqual(terminalRows, [
        {
          state: "error",
          completedAt: "2026-01-01T00:00:10.000Z",
          activeTurnId: null,
        },
      ]);

      yield* runMigrations({ toMigrationInclusive: 36 });

      const runRows = yield* sql<{
        readonly id: string;
        readonly status: string;
        readonly errorMessage: string | null;
      }>`
        SELECT
          id,
          status,
          error_message AS "errorMessage"
        FROM agent_runs
        ORDER BY id ASC
      `;
      assert.deepEqual(runRows, [
        { id: "run-latest-complete", status: "complete", errorMessage: null },
        { id: "run-still-running", status: "running", errorMessage: null },
      ]);
    }),
  );
});
