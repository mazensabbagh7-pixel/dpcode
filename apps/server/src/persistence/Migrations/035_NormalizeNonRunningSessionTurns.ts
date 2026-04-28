import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    UPDATE projection_turns
    SET
      state = CASE (
        SELECT projection_thread_sessions.status
        FROM projection_thread_sessions
        WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
      )
        WHEN 'error' THEN 'error'
        WHEN 'interrupted' THEN 'interrupted'
        ELSE CASE
          WHEN projection_turns.state = 'error' THEN 'error'
          WHEN projection_turns.state = 'interrupted' THEN 'interrupted'
          ELSE 'completed'
        END
      END,
      requested_at = COALESCE(
        projection_turns.requested_at,
        (
          SELECT projection_thread_sessions.updated_at
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
        )
      ),
      started_at = COALESCE(
        projection_turns.started_at,
        projection_turns.requested_at,
        (
          SELECT projection_thread_sessions.updated_at
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
        )
      ),
      completed_at = COALESCE(
        projection_turns.completed_at,
        (
          SELECT projection_thread_sessions.updated_at
          FROM projection_thread_sessions
          WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
        )
      )
    WHERE projection_turns.turn_id IS NOT NULL
      AND projection_turns.completed_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM projection_thread_sessions
        WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
          AND projection_thread_sessions.status = 'ready'
      )
  `;

  yield* sql`
    DELETE FROM projection_turns
    WHERE projection_turns.turn_id IS NULL
      AND projection_turns.state = 'pending'
      AND EXISTS (
        SELECT 1
        FROM projection_thread_sessions
        WHERE projection_thread_sessions.thread_id = projection_turns.thread_id
          AND projection_thread_sessions.status = 'ready'
      )
  `;

  yield* sql`
    UPDATE projection_thread_sessions
    SET active_turn_id = NULL
    WHERE active_turn_id IS NOT NULL
      AND status = 'ready'
  `;
});
