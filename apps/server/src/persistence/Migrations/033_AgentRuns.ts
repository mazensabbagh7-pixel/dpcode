import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id             TEXT PRIMARY KEY,
      agent_id       TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
      thread_id      TEXT NOT NULL,
      trigger        TEXT NOT NULL,
      status         TEXT NOT NULL,
      started_at     INTEGER NOT NULL,
      ended_at       INTEGER,
      error_message  TEXT,
      rendered_task  TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent
    ON agent_runs(agent_id, started_at DESC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status
    ON agent_runs(status, started_at DESC)
  `;
});
