import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS agent_definitions (
      id              TEXT PRIMARY KEY,
      project_id      TEXT NOT NULL DEFAULT '',
      name            TEXT NOT NULL,
      description     TEXT,
      provider        TEXT NOT NULL,
      model_selection TEXT NOT NULL,
      system_prompt   TEXT,
      task_template   TEXT NOT NULL,
      tool_allowlist  TEXT NOT NULL DEFAULT '[]',
      cwd             TEXT,
      env_mode        TEXT NOT NULL DEFAULT 'local',
      schedule        TEXT,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      last_run_at     INTEGER
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_definitions_updated_at
    ON agent_definitions(updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_definitions_enabled_schedule
    ON agent_definitions(enabled, schedule)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_definitions_project_id
    ON agent_definitions(project_id)
  `;
});
