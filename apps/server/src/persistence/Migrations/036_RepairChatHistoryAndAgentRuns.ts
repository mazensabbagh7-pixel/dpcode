import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    WITH ranked_chat_projects AS (
      SELECT
        project_id,
        FIRST_VALUE(project_id) OVER (
          PARTITION BY workspace_root
          ORDER BY created_at ASC, project_id ASC
        ) AS canonical_project_id,
        ROW_NUMBER() OVER (
          PARTITION BY workspace_root
          ORDER BY created_at ASC, project_id ASC
        ) AS row_number
      FROM projection_projects
      WHERE kind = 'chat'
        AND deleted_at IS NULL
    )
    UPDATE projection_threads
    SET project_id = (
      SELECT canonical_project_id
      FROM ranked_chat_projects
      WHERE ranked_chat_projects.project_id = projection_threads.project_id
    )
    WHERE project_id IN (
      SELECT project_id
      FROM ranked_chat_projects
      WHERE row_number > 1
    )
  `;

  yield* sql`
    WITH ranked_chat_projects AS (
      SELECT
        project_id,
        ROW_NUMBER() OVER (
          PARTITION BY workspace_root
          ORDER BY created_at ASC, project_id ASC
        ) AS row_number
      FROM projection_projects
      WHERE kind = 'chat'
        AND deleted_at IS NULL
    )
    UPDATE projection_projects
    SET
      deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id IN (
      SELECT project_id
      FROM ranked_chat_projects
      WHERE row_number > 1
    )
  `;

  yield* sql`
    WITH latest_turns AS (
      SELECT
        thread_id,
        state,
        completed_at,
        requested_at,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY requested_at DESC, COALESCE(turn_id, '') DESC, row_id DESC
        ) AS row_number
      FROM projection_turns
      WHERE turn_id IS NOT NULL
    )
    UPDATE agent_runs
    SET
      status = CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM projection_threads
          WHERE projection_threads.thread_id = agent_runs.thread_id
        ) THEN 'cancelled'
        WHEN EXISTS (
          SELECT 1
          FROM projection_threads
          WHERE projection_threads.thread_id = agent_runs.thread_id
            AND projection_threads.deleted_at IS NOT NULL
        ) THEN 'cancelled'
        WHEN EXISTS (
          SELECT 1
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = agent_runs.thread_id
            AND projection_thread_sessions.status = 'error'
        ) THEN 'failed'
        WHEN EXISTS (
          SELECT 1
          FROM latest_turns
          WHERE latest_turns.thread_id = agent_runs.thread_id
            AND latest_turns.row_number = 1
            AND latest_turns.state = 'error'
            AND latest_turns.completed_at IS NOT NULL
        ) THEN 'failed'
        WHEN EXISTS (
          SELECT 1
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = agent_runs.thread_id
            AND projection_thread_sessions.status IN ('stopped', 'interrupted')
        ) THEN 'cancelled'
        WHEN EXISTS (
          SELECT 1
          FROM latest_turns
          WHERE latest_turns.thread_id = agent_runs.thread_id
            AND latest_turns.row_number = 1
            AND latest_turns.state = 'interrupted'
            AND latest_turns.completed_at IS NOT NULL
        ) THEN 'cancelled'
        ELSE 'complete'
      END,
      ended_at = COALESCE(
        ended_at,
        CAST(strftime(
          '%s',
          COALESCE(
            (
              SELECT latest_turns.completed_at
              FROM latest_turns
              WHERE latest_turns.thread_id = agent_runs.thread_id
                AND latest_turns.row_number = 1
                AND latest_turns.completed_at IS NOT NULL
              LIMIT 1
            ),
            (
              SELECT projection_thread_sessions.updated_at
              FROM projection_thread_sessions
              WHERE projection_thread_sessions.thread_id = agent_runs.thread_id
              LIMIT 1
            ),
            (
              SELECT projection_threads.updated_at
              FROM projection_threads
              WHERE projection_threads.thread_id = agent_runs.thread_id
              LIMIT 1
            ),
            strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
        ) * 1000 AS INTEGER)
      ),
      error_message = CASE
        WHEN error_message IS NULL
          AND (
            EXISTS (
              SELECT 1
              FROM projection_thread_sessions
              WHERE projection_thread_sessions.thread_id = agent_runs.thread_id
                AND projection_thread_sessions.status = 'error'
            )
            OR EXISTS (
              SELECT 1
              FROM latest_turns
              WHERE latest_turns.thread_id = agent_runs.thread_id
                AND latest_turns.row_number = 1
                AND latest_turns.state = 'error'
                AND latest_turns.completed_at IS NOT NULL
            )
          )
          THEN 'Agent run was reconciled from a failed terminal thread state.'
        ELSE error_message
      END
    WHERE status IN ('queued', 'running')
      AND NOT EXISTS (
        SELECT 1
        FROM projection_thread_sessions
        WHERE projection_thread_sessions.thread_id = agent_runs.thread_id
          AND projection_thread_sessions.status = 'running'
      )
      AND (
        NOT EXISTS (
          SELECT 1
          FROM projection_threads
          WHERE projection_threads.thread_id = agent_runs.thread_id
        )
        OR EXISTS (
          SELECT 1
          FROM projection_threads
          WHERE projection_threads.thread_id = agent_runs.thread_id
            AND projection_threads.deleted_at IS NOT NULL
        )
        OR EXISTS (
          SELECT 1
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = agent_runs.thread_id
            AND projection_thread_sessions.status IN ('ready', 'stopped', 'error', 'interrupted')
        )
        OR EXISTS (
          SELECT 1
          FROM latest_turns
          WHERE latest_turns.thread_id = agent_runs.thread_id
            AND latest_turns.row_number = 1
            AND latest_turns.completed_at IS NOT NULL
        )
      )
  `;
});
