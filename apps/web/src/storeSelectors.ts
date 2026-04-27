// FILE: storeSelectors.ts
// Purpose: Stable Zustand selectors for entity lookups and lightweight sidebar projections.
// Exports: Selector factories used by routes and sidebar-heavy components.

import type { ProjectId, ThreadId } from "@t3tools/contracts";
import { normalizeWorkspaceRootForComparison } from "@t3tools/shared/threadWorkspace";

import type { AppState } from "./store";
import { getThreadFromState, getThreadsFromState } from "./threadDerivation";
import type { Project, SidebarThreadSummary, Thread } from "./types";

export interface ThreadPickerThread {
  id: ThreadId;
  title: string | null;
  projectId: ProjectId;
  modelSelection: Thread["modelSelection"];
  createdAt: string;
  updatedAt?: string | undefined;
}

export interface SplitWorkspaceCollision {
  leftThreadId: ThreadId;
  rightThreadId: ThreadId;
  workspacePath: string;
  leftBranch: string | null;
  rightBranch: string | null;
}

const EMPTY_THREAD_PICKER_THREADS: readonly ThreadPickerThread[] = [];

function createStableEntitySelector<T extends { id: string }>(
  selectItems: (state: AppState) => readonly T[],
  id: string | null | undefined,
): (state: AppState) => T | undefined {
  let previousItems: readonly T[] | undefined;
  let previousMatch: T | undefined;

  return (state) => {
    if (!id) {
      return undefined;
    }

    const items = selectItems(state);
    if (items === previousItems) {
      return previousMatch;
    }

    previousItems = items;
    previousMatch = items.find((item) => item.id === id);
    return previousMatch;
  };
}

export function createProjectSelector(
  projectId: ProjectId | null | undefined,
): (state: AppState) => Project | undefined {
  return createStableEntitySelector((state) => state.projects, projectId);
}

export function createThreadSelector(
  threadId: ThreadId | null | undefined,
): (state: AppState) => Thread | undefined {
  return (state) =>
    threadId
      ? (getThreadFromState(state, threadId) ??
        state.threads.find((thread) => thread.id === threadId))
      : undefined;
}

export function createAllThreadsSelector(): (state: AppState) => readonly Thread[] {
  let previousThreadIds: readonly ThreadId[] | undefined;
  let previousThreadShellById = {} as AppState["threadShellById"];
  let previousThreadSessionById = {} as AppState["threadSessionById"];
  let previousThreadTurnStateById = {} as AppState["threadTurnStateById"];
  let previousMessageIdsByThreadId = {} as AppState["messageIdsByThreadId"];
  let previousMessageByThreadId = {} as AppState["messageByThreadId"];
  let previousActivityIdsByThreadId = {} as AppState["activityIdsByThreadId"];
  let previousActivityByThreadId = {} as AppState["activityByThreadId"];
  let previousProposedPlanIdsByThreadId = {} as AppState["proposedPlanIdsByThreadId"];
  let previousProposedPlanByThreadId = {} as AppState["proposedPlanByThreadId"];
  let previousTurnDiffIdsByThreadId = {} as AppState["turnDiffIdsByThreadId"];
  let previousTurnDiffSummaryByThreadId = {} as AppState["turnDiffSummaryByThreadId"];
  let previousThreads: readonly Thread[] = [];

  return (state) => {
    if (
      previousThreadIds === state.threadIds &&
      previousThreadShellById === state.threadShellById &&
      previousThreadSessionById === state.threadSessionById &&
      previousThreadTurnStateById === state.threadTurnStateById &&
      previousMessageIdsByThreadId === state.messageIdsByThreadId &&
      previousMessageByThreadId === state.messageByThreadId &&
      previousActivityIdsByThreadId === state.activityIdsByThreadId &&
      previousActivityByThreadId === state.activityByThreadId &&
      previousProposedPlanIdsByThreadId === state.proposedPlanIdsByThreadId &&
      previousProposedPlanByThreadId === state.proposedPlanByThreadId &&
      previousTurnDiffIdsByThreadId === state.turnDiffIdsByThreadId &&
      previousTurnDiffSummaryByThreadId === state.turnDiffSummaryByThreadId
    ) {
      return previousThreads;
    }

    previousThreadIds = state.threadIds;
    previousThreadShellById = state.threadShellById;
    previousThreadSessionById = state.threadSessionById;
    previousThreadTurnStateById = state.threadTurnStateById;
    previousMessageIdsByThreadId = state.messageIdsByThreadId;
    previousMessageByThreadId = state.messageByThreadId;
    previousActivityIdsByThreadId = state.activityIdsByThreadId;
    previousActivityByThreadId = state.activityByThreadId;
    previousProposedPlanIdsByThreadId = state.proposedPlanIdsByThreadId;
    previousProposedPlanByThreadId = state.proposedPlanByThreadId;
    previousTurnDiffIdsByThreadId = state.turnDiffIdsByThreadId;
    previousTurnDiffSummaryByThreadId = state.turnDiffSummaryByThreadId;
    previousThreads = getThreadsFromState(state);
    return previousThreads;
  };
}

export function createThreadPickerThreadsSelector(options?: {
  enabled?: boolean;
}): (state: AppState) => readonly ThreadPickerThread[] {
  const enabled = options?.enabled ?? true;
  let previousThreadIds: readonly ThreadId[] | undefined;
  let previousThreadShellById = {} as AppState["threadShellById"];
  let previousThreads: readonly ThreadPickerThread[] = EMPTY_THREAD_PICKER_THREADS;

  return (state) => {
    if (!enabled) {
      return EMPTY_THREAD_PICKER_THREADS;
    }

    if (
      previousThreadIds === state.threadIds &&
      previousThreadShellById === state.threadShellById
    ) {
      return previousThreads;
    }

    previousThreadIds = state.threadIds;
    previousThreadShellById = state.threadShellById;
    previousThreads = (state.threadIds ?? []).flatMap((threadId) => {
      const shell = state.threadShellById?.[threadId];
      if (!shell) {
        return [];
      }
      return [
        {
          id: shell.id,
          title: shell.title,
          projectId: shell.projectId,
          modelSelection: shell.modelSelection,
          createdAt: shell.createdAt,
          updatedAt: shell.updatedAt,
        },
      ];
    });
    return previousThreads;
  };
}

export function createSplitWorkspaceCollisionSelector(input: {
  leftThreadId: ThreadId | null;
  rightThreadId: ThreadId | null;
}): (state: AppState) => SplitWorkspaceCollision | null {
  let previousThreadShellById = {} as AppState["threadShellById"];
  let previousProjects: readonly Project[] | undefined;
  let previousCollision: SplitWorkspaceCollision | null = null;

  return (state) => {
    if (!input.leftThreadId || !input.rightThreadId) {
      return null;
    }

    if (previousThreadShellById === state.threadShellById && previousProjects === state.projects) {
      return previousCollision;
    }

    previousThreadShellById = state.threadShellById;
    previousProjects = state.projects;

    const leftShell = state.threadShellById?.[input.leftThreadId];
    const rightShell = state.threadShellById?.[input.rightThreadId];
    if (!leftShell || !rightShell) {
      previousCollision = null;
      return previousCollision;
    }

    const leftWorkspacePath = resolveThreadWorkspacePath(state.projects, leftShell);
    const rightWorkspacePath = resolveThreadWorkspacePath(state.projects, rightShell);
    if (!leftWorkspacePath || !rightWorkspacePath) {
      previousCollision = null;
      return previousCollision;
    }

    if (
      normalizeWorkspaceRootForComparison(leftWorkspacePath) !==
      normalizeWorkspaceRootForComparison(rightWorkspacePath)
    ) {
      previousCollision = null;
      return previousCollision;
    }

    previousCollision = {
      leftThreadId: input.leftThreadId,
      rightThreadId: input.rightThreadId,
      workspacePath: leftWorkspacePath,
      leftBranch: leftShell.branch,
      rightBranch: rightShell.branch,
    };
    return previousCollision;
  };
}

function resolveThreadWorkspacePath(
  projects: readonly Project[],
  thread: Pick<Thread, "projectId" | "worktreePath">,
): string | null {
  if (thread.worktreePath) {
    return thread.worktreePath;
  }
  return projects.find((project) => project.id === thread.projectId)?.cwd ?? null;
}

export function createThreadProjectIdSelector(
  threadId: ThreadId | null | undefined,
): (state: AppState) => ProjectId | null {
  const selectThread = createThreadSelector(threadId);
  return (state) => selectThread(state)?.projectId ?? null;
}

export function createThreadExistsSelector(
  threadId: ThreadId | null | undefined,
): (state: AppState) => boolean {
  const selectThread = createThreadSelector(threadId);
  return (state) => selectThread(state) !== undefined;
}

export function createSidebarThreadSummarySelector(
  threadId: ThreadId | null | undefined,
): (state: AppState) => SidebarThreadSummary | undefined {
  return (state) => (threadId ? state.sidebarThreadSummaryById[threadId] : undefined);
}

export function createSidebarThreadSummariesSelector(): (
  state: AppState,
) => readonly SidebarThreadSummary[] {
  let previousThreadIds: readonly ThreadId[] | undefined;
  let previousSummaryById: Record<string, SidebarThreadSummary> | undefined;
  let previousSummaries: readonly SidebarThreadSummary[] = [];

  return (state) => {
    const threadIds = state.threadIds ?? state.threads.map((thread) => thread.id);
    if (threadIds === previousThreadIds && state.sidebarThreadSummaryById === previousSummaryById) {
      return previousSummaries;
    }

    previousThreadIds = threadIds;
    previousSummaryById = state.sidebarThreadSummaryById;
    previousSummaries = threadIds.flatMap((threadId) => {
      const summary = state.sidebarThreadSummaryById[threadId];
      return summary ? [summary] : [];
    });
    return previousSummaries;
  };
}

export function createSidebarDisplayThreadsSelector(): (
  state: AppState,
) => readonly SidebarThreadSummary[] {
  const selectSidebarSummaries = createSidebarThreadSummariesSelector();
  let previousSummaries: readonly SidebarThreadSummary[] | undefined;
  let previousDisplaySummaries: readonly SidebarThreadSummary[] = [];

  return (state) => {
    const sidebarSummaries = selectSidebarSummaries(state);
    if (sidebarSummaries === previousSummaries) {
      return previousDisplaySummaries;
    }

    previousSummaries = sidebarSummaries;
    previousDisplaySummaries = sidebarSummaries.filter(
      (thread) => !thread.parentThreadId && thread.archivedAt == null,
    );
    return previousDisplaySummaries;
  };
}

export function createFirstProjectSelector(): (state: AppState) => Project | undefined {
  let previousProjects: readonly Project[] | undefined;
  let previousFirstProject: Project | undefined;

  return (state) => {
    if (state.projects === previousProjects) {
      return previousFirstProject;
    }

    previousProjects = state.projects;
    previousFirstProject = state.projects.find((project) => project.kind === "project");
    return previousFirstProject;
  };
}

export function createProjectsByKindSelector(
  kind: Project["kind"],
): (state: AppState) => readonly Project[] {
  let previousProjects: readonly Project[] | undefined;
  let previousFiltered: readonly Project[] = [];

  return (state) => {
    if (state.projects === previousProjects) {
      return previousFiltered;
    }

    previousProjects = state.projects;
    previousFiltered = state.projects.filter((project) => project.kind === kind);
    return previousFiltered;
  };
}
