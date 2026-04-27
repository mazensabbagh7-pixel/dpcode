import { ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { AgentRepository } from "../Services/Agents.ts";
import { AgentRepositoryLive } from "./Agents.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const agentRepositoryLayer = it.layer(
  Layer.mergeAll(
    AgentRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

agentRepositoryLayer("AgentRepository", (it) => {
  it.effect("finishes running agent runs by thread id", () =>
    Effect.gen(function* () {
      const agents = yield* AgentRepository;

      yield* agents.upsert({
        id: "agent-1",
        projectId: ProjectId.makeUnsafe("project-1"),
        name: "Agent One",
        description: null,
        provider: "claudeAgent",
        modelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-5",
        },
        systemPrompt: "Stay scoped.",
        taskTemplate: "Run the task.",
        toolAllowlist: ["Bash"],
        cwd: null,
        envMode: "local",
        schedule: null,
        enabled: true,
        createdAt: 10,
        updatedAt: 10,
        lastRunAt: null,
      });

      yield* agents.upsertRun({
        id: "run-1",
        agentId: "agent-1",
        threadId: "thread-1",
        trigger: "manual",
        status: "running",
        startedAt: 20,
        endedAt: null,
        errorMessage: null,
        renderedTask: "Run the task.",
      });

      yield* agents.finishRunsForThread({
        threadId: "thread-1",
        status: "complete",
        endedAt: 30,
        errorMessage: null,
      });

      const runs = yield* agents.listRunsForAgent({ agentId: "agent-1" });
      assert.strictEqual(runs.length, 1);
      assert.strictEqual(runs[0]?.status, "complete");
      assert.strictEqual(runs[0]?.endedAt, 30);
      assert.strictEqual(runs[0]?.errorMessage, null);
    }),
  );
});
