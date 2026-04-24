import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{
    name: string;
  }>`
    SELECT name
    FROM pragma_table_info('agent_definitions')
    WHERE name = 'project_id'
  `;

  if (columns.length > 0) {
    return;
  }

  yield* sql`
    ALTER TABLE agent_definitions
    ADD COLUMN project_id TEXT NOT NULL DEFAULT ''
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_agent_definitions_project_id
    ON agent_definitions(project_id)
  `;
});
