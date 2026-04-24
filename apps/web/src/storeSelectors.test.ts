import { ProjectId, ThreadId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { AppState } from "./store";
import {
  createSplitWorkspaceCollisionSelector,
  createThreadPickerThreadsSelector,
} from "./storeSelectors";
import type { ThreadShell } from "./types";

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const OTHER_PROJECT_ID = ProjectId.makeUnsafe("project-2");
const THREAD_ID = ThreadId.makeUnsafe("thread-1");
const OTHER_THREAD_ID = ThreadId.makeUnsafe("thread-2");
const CODEX_MODEL: ModelSelection = {
  provider: "codex",
  model: "gpt-5.5",
};
const CLAUDE_MODEL: ModelSelection = {
  provider: "claudeAgent",
  model: "claude-opus-4-7",
};

function makeThreadShell(overrides: Partial<ThreadShell> = {}): ThreadShell {
  return {
    id: THREAD_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "First thread",
    modelSelection: CODEX_MODEL,
    runtimeMode: "full-access",
    interactionMode: "default",
    error: null,
    createdAt: "2026-04-24T10:00:00.000Z",
    updatedAt: "2026-04-24T10:00:00.000Z",
    branch: "main",
    worktreePath: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    projects: [
      {
        id: PROJECT_ID,
        kind: "project",
        name: "dpcode",
        remoteName: "dpcode",
        folderName: "dpcode",
        localName: null,
        cwd: "/home/mazen/Documents/GitHub/dpcode",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      },
      {
        id: OTHER_PROJECT_ID,
        kind: "project",
        name: "other",
        remoteName: "other",
        folderName: "other",
        localName: null,
        cwd: "/home/mazen/Documents/GitHub/other",
        defaultModelSelection: null,
        expanded: true,
        scripts: [],
      },
    ],
    threads: [],
    sidebarThreadSummaryById: {},
    threadsHydrated: true,
    threadIds: [THREAD_ID],
    threadShellById: {
      [THREAD_ID]: makeThreadShell(),
    },
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    ...overrides,
  };
}

describe("createThreadPickerThreadsSelector", () => {
  it("returns a stable empty list when the picker is disabled", () => {
    const selector = createThreadPickerThreadsSelector({ enabled: false });
    const firstResult = selector(makeState());
    const secondResult = selector(
      makeState({
        threadShellById: {
          [THREAD_ID]: makeThreadShell({ title: "Updated while picker closed" }),
        },
      }),
    );

    expect(firstResult).toBe(secondResult);
    expect(firstResult).toEqual([]);
  });

  it("ignores detail-only thread changes that are not used by the picker", () => {
    const selector = createThreadPickerThreadsSelector();
    const state = makeState();
    const firstResult = selector(state);
    const secondResult = selector({
      ...state,
      messageIdsByThreadId: {
        [THREAD_ID]: [],
      },
    });

    expect(secondResult).toBe(firstResult);
  });

  it("tracks only the shell fields needed by split chat pickers", () => {
    const selector = createThreadPickerThreadsSelector();
    const result = selector(
      makeState({
        threadShellById: {
          [THREAD_ID]: makeThreadShell({
            title: "Claude pane",
            modelSelection: CLAUDE_MODEL,
          }),
        },
      }),
    );

    expect(result).toEqual([
      {
        id: THREAD_ID,
        title: "Claude pane",
        projectId: PROJECT_ID,
        modelSelection: CLAUDE_MODEL,
        createdAt: "2026-04-24T10:00:00.000Z",
        updatedAt: "2026-04-24T10:00:00.000Z",
      },
    ]);
  });
});

describe("createSplitWorkspaceCollisionSelector", () => {
  it("detects split panes that share the same project workspace", () => {
    const selector = createSplitWorkspaceCollisionSelector({
      leftThreadId: THREAD_ID,
      rightThreadId: OTHER_THREAD_ID,
    });

    const result = selector(
      makeState({
        threadIds: [THREAD_ID, OTHER_THREAD_ID],
        threadShellById: {
          [THREAD_ID]: makeThreadShell({ id: THREAD_ID, modelSelection: CODEX_MODEL }),
          [OTHER_THREAD_ID]: makeThreadShell({
            id: OTHER_THREAD_ID,
            title: "Claude pane",
            modelSelection: CLAUDE_MODEL,
          }),
        },
      }),
    );

    expect(result).toEqual({
      leftThreadId: THREAD_ID,
      rightThreadId: OTHER_THREAD_ID,
      workspacePath: "/home/mazen/Documents/GitHub/dpcode",
      leftBranch: "main",
      rightBranch: "main",
    });
  });

  it("does not warn when split panes use different worktrees", () => {
    const selector = createSplitWorkspaceCollisionSelector({
      leftThreadId: THREAD_ID,
      rightThreadId: OTHER_THREAD_ID,
    });

    const result = selector(
      makeState({
        threadIds: [THREAD_ID, OTHER_THREAD_ID],
        threadShellById: {
          [THREAD_ID]: makeThreadShell({ id: THREAD_ID }),
          [OTHER_THREAD_ID]: makeThreadShell({
            id: OTHER_THREAD_ID,
            worktreePath: "/home/mazen/Documents/GitHub/dpcode-worktree",
          }),
        },
      }),
    );

    expect(result).toBeNull();
  });

  it("does not warn when split panes use different project roots", () => {
    const selector = createSplitWorkspaceCollisionSelector({
      leftThreadId: THREAD_ID,
      rightThreadId: OTHER_THREAD_ID,
    });

    const result = selector(
      makeState({
        threadIds: [THREAD_ID, OTHER_THREAD_ID],
        threadShellById: {
          [THREAD_ID]: makeThreadShell({ id: THREAD_ID }),
          [OTHER_THREAD_ID]: makeThreadShell({
            id: OTHER_THREAD_ID,
            projectId: OTHER_PROJECT_ID,
          }),
        },
      }),
    );

    expect(result).toBeNull();
  });
});
