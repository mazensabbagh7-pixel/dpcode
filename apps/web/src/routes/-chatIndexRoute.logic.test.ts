import type { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { resolveChatIndexResumeThread } from "./-chatIndexRoute.logic";
import type { SidebarThreadSummary } from "../types";

function makeThread(
  id: string,
  input: Partial<Pick<SidebarThreadSummary, "createdAt" | "updatedAt" | "latestUserMessageAt">>,
): SidebarThreadSummary {
  return {
    id: id as ThreadId,
    projectId: "project-1" as SidebarThreadSummary["projectId"],
    title: id,
    modelSelection: { provider: "codex", model: "gpt-5.5" },
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    session: null,
    createdAt: input.createdAt ?? "2026-04-27T10:00:00.000Z",
    updatedAt: input.updatedAt,
    latestTurn: null,
    latestUserMessageAt: input.latestUserMessageAt ?? null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    hasLiveTailWork: false,
  };
}

describe("resolveChatIndexResumeThread", () => {
  it("restores the persisted last thread route when it still exists", () => {
    expect(
      resolveChatIndexResumeThread({
        lastThreadRoute: { threadId: "thread-1", splitViewId: "split-1" },
        threads: [makeThread("thread-1", {})],
      }),
    ).toEqual({ threadId: "thread-1", splitViewId: "split-1" });
  });

  it("falls back to the latest visible thread when the persisted route is stale", () => {
    expect(
      resolveChatIndexResumeThread({
        lastThreadRoute: { threadId: "deleted-thread" },
        threads: [
          makeThread("older", { latestUserMessageAt: "2026-04-27T10:00:00.000Z" }),
          makeThread("newer", { latestUserMessageAt: "2026-04-27T11:00:00.000Z" }),
        ],
      }),
    ).toEqual({ threadId: "newer" });
  });

  it("returns null when no saved threads are available", () => {
    expect(resolveChatIndexResumeThread({ lastThreadRoute: null, threads: [] })).toBeNull();
  });
});
