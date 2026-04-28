import { describe, expect, it } from "vitest";
import { TurnId, type GitStatusResult } from "@t3tools/contracts";
import {
  deriveTurnDiffSummaryCardState,
  deriveWorkingTreeDiffSummaryCardState,
} from "./DiffSummaryCard.logic";

function gitStatus(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    branch: "main",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

describe("deriveWorkingTreeDiffSummaryCardState", () => {
  it("returns empty when there are no changes", () => {
    const state = deriveWorkingTreeDiffSummaryCardState({
      status: gitStatus(),
      patch: "",
      summary: null,
    });
    expect(state.status).toBe("empty");
    expect(state.filesChanged).toBe(0);
  });

  it("summarizes working tree files", () => {
    const state = deriveWorkingTreeDiffSummaryCardState({
      status: gitStatus({
        hasWorkingTreeChanges: true,
        workingTree: {
          files: [{ path: "src/app.ts", insertions: 4, deletions: 1 }],
          insertions: 4,
          deletions: 1,
        },
      }),
      patch: "diff --git a/src/app.ts b/src/app.ts",
      summary: "Adds app wiring.",
    });
    expect(state.status).toBe("ready");
    expect(state.filesChanged).toBe(1);
    expect(state.summary).toBe("Adds app wiring.");
  });
});

describe("deriveTurnDiffSummaryCardState", () => {
  it("reports loading and aggregate stats", () => {
    const state = deriveTurnDiffSummaryCardState({
      isSummaryLoading: true,
      turnSummary: {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-28T00:00:00.000Z",
        files: [
          { path: "a.ts", additions: 2, deletions: 0 },
          { path: "b.ts", additions: 0, deletions: 3 },
        ],
      },
    });
    expect(state.status).toBe("loading");
    expect(state.insertions).toBe(2);
    expect(state.deletions).toBe(3);
  });

  it("surfaces summary errors", () => {
    const state = deriveTurnDiffSummaryCardState({
      turnSummary: {
        turnId: TurnId.makeUnsafe("turn-1"),
        completedAt: "2026-04-28T00:00:00.000Z",
        files: [{ path: "a.ts" }],
      },
      error: new Error("No checkpoint"),
    });
    expect(state.status).toBe("error");
    expect(state.errorMessage).toBe("No checkpoint");
  });
});
