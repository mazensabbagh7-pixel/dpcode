// FILE: WorkflowHub.tsx
// Purpose: Route-level operator surface for provider health, GitHub intake, worktree isolation, and git review.
// Layer: Route-level screen
// Exports: WorkflowHub

import type {
  GitStatusResult,
  ProviderKind,
  ServerProviderStatus,
  ThreadEnvironmentMode,
} from "@t3tools/contracts";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppSettings } from "~/appSettings";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import {
  gitCreateWorktreeMutationOptions,
  gitStatusQueryOptions,
  gitWorkingTreeDiffQueryOptions,
} from "~/lib/gitReactQuery";
import {
  serverConfigQueryOptions,
  serverProviderUsageSnapshotQueryOptions,
  serverQueryKeys,
  serverWorktreesQueryOptions,
} from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import type { Project } from "~/types";
import GitActionsControl from "./GitActionsControl";
import { PullRequestThreadDialog } from "./PullRequestThreadDialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "./ui/select";
import { SidebarHeaderTrigger, SidebarInset } from "./ui/sidebar";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";
import {
  CircleCheckIcon,
  GitForkIcon,
  GitHubIcon,
  GitPullRequestIcon,
  Loader2Icon,
  RefreshCwIcon,
} from "~/lib/icons";

const PROVIDER_ORDER: ReadonlyArray<ProviderKind> = ["claudeAgent", "codex", "gemini", "opencode"];

const DEFAULT_ISSUE_PROMPT =
  "Inspect this GitHub issue, summarize the requested change, map the affected files, then propose a focused implementation plan before editing.";

const DEFAULT_WORKTREE_PROMPT =
  "Work in this isolated worktree. Inspect the current repo state first, then implement the requested task with focused verification.";

function projectLabel(project: Project): string {
  return (
    project.localName || project.name || project.folderName || project.remoteName || project.cwd
  );
}

function getProjectOptions(projects: readonly Project[]): Project[] {
  return projects.filter((project) => project.kind === "project");
}

function statusBadgeVariant(status: ServerProviderStatus["status"]) {
  switch (status) {
    case "ready":
      return "success";
    case "warning":
      return "warning";
    case "error":
      return "error";
  }
}

function authBadgeVariant(authStatus: ServerProviderStatus["authStatus"]) {
  switch (authStatus) {
    case "authenticated":
      return "success";
    case "unauthenticated":
      return "warning";
    case "unknown":
      return "outline";
  }
}

function formatDateTime(value: string | undefined): string {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function parseGitHubReference(input: string): { kind: "issue" | "pull"; number: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch =
    /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(issues|pull)\/(\d+)(?:[/?#].*)?$/i.exec(trimmed);
  if (urlMatch?.[1] && urlMatch[2]) {
    return { kind: urlMatch[1].toLowerCase() === "pull" ? "pull" : "issue", number: urlMatch[2] };
  }
  const numberMatch = /^#?(\d+)$/.exec(trimmed);
  if (numberMatch?.[1]) {
    return { kind: "issue", number: numberMatch[1] };
  }
  return null;
}

function makeIssuePrompt(input: {
  reference: string;
  project: Project;
  taskPrompt: string;
}): string {
  const prompt = input.taskPrompt.trim() || DEFAULT_ISSUE_PROMPT;
  return [
    prompt,
    "",
    `GitHub reference: ${input.reference.trim()}`,
    `Repository path: ${input.project.cwd}`,
    "",
    "If GitHub CLI or connector context is available, load the issue directly before changing files. Keep changes scoped to the issue and verify with the repo's existing checks.",
  ].join("\n");
}

function makePullRequestPrompt(input: {
  number: number;
  title: string;
  url: string;
  baseBranch: string;
  headBranch: string;
}): string {
  return [
    `Review PR #${input.number}: ${input.title}`,
    "",
    `URL: ${input.url}`,
    `Branch: ${input.headBranch} -> ${input.baseBranch}`,
    "",
    "Inspect the checked out code, summarize what changed, identify risks, and run focused verification before making any follow-up edits.",
  ].join("\n");
}

function makeWorktreePrompt(input: {
  baseBranch: string;
  newBranch: string;
  project: Project;
  taskPrompt: string;
}): string {
  const prompt = input.taskPrompt.trim() || DEFAULT_WORKTREE_PROMPT;
  return [
    prompt,
    "",
    `Project: ${projectLabel(input.project)}`,
    `Base branch: ${input.baseBranch}`,
    `Worktree branch: ${input.newBranch}`,
    `Repository path: ${input.project.cwd}`,
  ].join("\n");
}

function ProviderUsageBlock(props: { provider: ProviderKind }) {
  const usageQuery = useQuery(
    serverProviderUsageSnapshotQueryOptions({ provider: props.provider }),
  );
  const snapshot = usageQuery.data;
  if (usageQuery.isPending) {
    return <p className="text-muted-foreground text-xs">Usage loading...</p>;
  }
  if (!snapshot) {
    return <p className="text-muted-foreground text-xs">No usage snapshot exposed.</p>;
  }
  return (
    <div className="space-y-1 text-xs">
      {snapshot.usageLines.slice(0, 3).map((line) => (
        <div
          key={`${line.label}:${line.value}`}
          className="flex items-center justify-between gap-3"
        >
          <span className="truncate text-muted-foreground">{line.label}</span>
          <span className="shrink-0 text-foreground">{line.value}</span>
        </div>
      ))}
      {snapshot.limits.slice(0, 2).map((limit) => (
        <div key={limit.window} className="flex items-center justify-between gap-3">
          <span className="truncate text-muted-foreground">{limit.window}</span>
          <span className="shrink-0 text-foreground">
            {typeof limit.usedPercent === "number" ? `${Math.round(limit.usedPercent)}%` : "live"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProviderCard(props: { provider: ProviderKind; status: ServerProviderStatus | null }) {
  const status = props.status;
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {PROVIDER_DISPLAY_NAMES[props.provider]}
            </span>
            {status?.available ? (
              <CircleCheckIcon className="size-3.5 text-success-foreground" />
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
            {status?.message ?? "Provider has not reported status yet."}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge size="sm" variant={status ? statusBadgeVariant(status.status) : "outline"}>
            {status?.status ?? "unknown"}
          </Badge>
          <Badge size="sm" variant={status ? authBadgeVariant(status.authStatus) : "outline"}>
            {status?.authStatus ?? "unknown"}
          </Badge>
        </div>
      </div>
      <div className="mt-3 grid gap-1 border-t border-border/70 pt-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Auth</span>
          <span className="truncate text-right">
            {status?.authLabel ?? status?.authType ?? "n/a"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Checked</span>
          <span>{formatDateTime(status?.checkedAt)}</span>
        </div>
      </div>
      <div className="mt-3 border-t border-border/70 pt-3">
        <ProviderUsageBlock provider={props.provider} />
      </div>
    </div>
  );
}

function RepoStatusBlock(props: { status: GitStatusResult | null; isLoading: boolean }) {
  const status = props.status;
  if (props.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading git status...</p>;
  }
  if (!status) {
    return <p className="text-muted-foreground text-sm">No git status available.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div className="rounded-lg border border-border bg-muted/18 p-3">
        <p className="text-muted-foreground text-xs">Branch</p>
        <p className="truncate text-sm font-medium">{status.branch ?? "detached"}</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/18 p-3">
        <p className="text-muted-foreground text-xs">Changes</p>
        <p className="text-sm font-medium">{status.workingTree.files.length} files</p>
      </div>
      <div className="rounded-lg border border-border bg-muted/18 p-3">
        <p className="text-muted-foreground text-xs">Diff</p>
        <p className="text-sm font-medium">
          +{status.workingTree.insertions} -{status.workingTree.deletions}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/18 p-3">
        <p className="text-muted-foreground text-xs">Remote</p>
        <p className="text-sm font-medium">
          {status.aheadCount} ahead / {status.behindCount} behind
        </p>
      </div>
    </div>
  );
}

export function WorkflowHub() {
  const queryClient = useQueryClient();
  const projects = useStore((state) => state.projects);
  const projectOptions = useMemo(() => getProjectOptions(projects), [projects]);
  const { settings } = useAppSettings();
  const defaultProvider = settings.defaultProvider;
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [provider, setProvider] = useState<ProviderKind>(defaultProvider);
  const [githubReference, setGithubReference] = useState("");
  const [githubPrompt, setGithubPrompt] = useState(DEFAULT_ISSUE_PROMPT);
  const [prDialogOpen, setPrDialogOpen] = useState(false);
  const [baseBranch, setBaseBranch] = useState("main");
  const [newBranch, setNewBranch] = useState("");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreePrompt, setWorktreePrompt] = useState(DEFAULT_WORKTREE_PROMPT);
  const { handleNewThread } = useHandleNewThread();

  useEffect(() => {
    if (projectOptions.length === 0) {
      setSelectedProjectId("");
      return;
    }
    setSelectedProjectId((current) =>
      projectOptions.some((project) => project.id === current) ? current : projectOptions[0]!.id,
    );
  }, [projectOptions]);

  const selectedProject = useMemo(
    () => projectOptions.find((project) => project.id === selectedProjectId) ?? null,
    [projectOptions, selectedProjectId],
  );
  const selectedCwd = selectedProject?.cwd ?? null;
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const serverWorktreesQuery = useQuery(serverWorktreesQueryOptions());
  const gitStatusQuery = useQuery(gitStatusQueryOptions(selectedCwd));
  const workingTreeDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({ cwd: selectedCwd, enabled: selectedCwd !== null }),
  );
  const createWorktreeMutation = useMutation(gitCreateWorktreeMutationOptions({ queryClient }));

  useEffect(() => {
    const branch = gitStatusQuery.data?.branch;
    if (!branch) return;
    setBaseBranch((current) =>
      current.trim().length === 0 || current === "main" ? branch : current,
    );
  }, [gitStatusQuery.data?.branch]);

  const providerStatusByKind = useMemo(() => {
    const map = new Map<ProviderKind, ServerProviderStatus>();
    for (const status of serverConfigQuery.data?.providers ?? []) {
      map.set(status.provider, status);
    }
    return map;
  }, [serverConfigQuery.data?.providers]);

  const refreshProviders = useCallback(async () => {
    const api = ensureNativeApi();
    const promise = api.server.refreshProviders();
    toastManager.promise(promise, {
      loading: { title: "Refreshing providers..." },
      success: { title: "Provider health refreshed" },
      error: (error) => ({
        title: "Provider refresh failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    });
    await promise;
    await queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
  }, [queryClient]);

  const startIssueThread = useCallback(async () => {
    if (!selectedProject) {
      toastManager.add({ type: "error", title: "Select a project first" });
      return;
    }
    const parsedReference = parseGitHubReference(githubReference);
    if (!parsedReference) {
      toastManager.add({
        type: "error",
        title: "Invalid GitHub reference",
        description: "Use a GitHub issue URL, PR URL, #123, or 123.",
      });
      return;
    }
    if (parsedReference.kind === "pull") {
      setPrDialogOpen(true);
      return;
    }
    const threadId = await handleNewThread(selectedProject.id, {
      fresh: true,
      provider,
      envMode: "local",
    });
    useComposerDraftStore.getState().setPrompt(
      threadId,
      makeIssuePrompt({
        reference: githubReference,
        project: selectedProject,
        taskPrompt: githubPrompt,
      }),
    );
  }, [githubPrompt, githubReference, handleNewThread, provider, selectedProject]);

  const createIsolatedWorktree = useCallback(async () => {
    if (!selectedProject) {
      toastManager.add({ type: "error", title: "Select a project first" });
      return;
    }
    const trimmedBaseBranch = baseBranch.trim();
    const trimmedNewBranch = newBranch.trim();
    if (!trimmedBaseBranch || !trimmedNewBranch) {
      toastManager.add({
        type: "error",
        title: "Branch names required",
        description: "Set both the base branch and the new isolated branch.",
      });
      return;
    }
    const result = await createWorktreeMutation.mutateAsync({
      cwd: selectedProject.cwd,
      branch: trimmedBaseBranch,
      newBranch: trimmedNewBranch,
      path: worktreePath.trim() || null,
    });
    await queryClient.invalidateQueries({ queryKey: serverQueryKeys.worktrees() });
    const threadId = await handleNewThread(selectedProject.id, {
      fresh: true,
      provider,
      envMode: "worktree",
      branch: result.worktree.branch,
      worktreePath: result.worktree.path,
    });
    useComposerDraftStore.getState().setPrompt(
      threadId,
      makeWorktreePrompt({
        baseBranch: trimmedBaseBranch,
        newBranch: result.worktree.branch,
        project: selectedProject,
        taskPrompt: worktreePrompt,
      }),
    );
    toastManager.add({
      type: "success",
      title: "Worktree thread opened",
      description: result.worktree.path,
    });
  }, [
    baseBranch,
    createWorktreeMutation,
    handleNewThread,
    newBranch,
    provider,
    queryClient,
    selectedProject,
    worktreePath,
    worktreePrompt,
  ]);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
          <SidebarHeaderTrigger className="size-7 shrink-0" />
          <h1 className="text-[15px] font-semibold">Workflow</h1>
          <div className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshProviders()}
            disabled={serverConfigQuery.isFetching}
          >
            {serverConfigQuery.isFetching ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-col gap-5">
            <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Provider Catalog</h2>
                    <p className="text-muted-foreground text-xs">
                      Runtime health for the local model providers available in this app.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {PROVIDER_ORDER.map((providerKind) => (
                    <ProviderCard
                      key={providerKind}
                      provider={providerKind}
                      status={providerStatusByKind.get(providerKind) ?? null}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">Context</h2>
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Project</span>
                    <Select
                      value={selectedProjectId}
                      onValueChange={(value) => {
                        if (value) setSelectedProjectId(value);
                      }}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {projectOptions.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {projectLabel(project)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium">Provider</span>
                    <Select
                      value={provider}
                      onValueChange={(value) => setProvider(value as ProviderKind)}
                    >
                      <SelectTrigger size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {PROVIDER_ORDER.map((providerKind) => (
                          <SelectItem key={providerKind} value={providerKind}>
                            {PROVIDER_DISPLAY_NAMES[providerKind]}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </label>
                  <div className="rounded-lg border border-border bg-muted/18 p-3 text-xs">
                    <p className="font-medium">Managed worktrees</p>
                    <p className="mt-1 text-muted-foreground">
                      {serverWorktreesQuery.data?.worktrees.length ?? 0} known worktrees
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <GitHubIcon className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <h2 className="text-sm font-semibold">GitHub Issue / PR Intake</h2>
                    <p className="text-muted-foreground text-xs">
                      Start a focused thread from an issue, or resolve a PR into local/worktree
                      context.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <Input
                    placeholder="https://github.com/owner/repo/issues/123, /pull/123, or #123"
                    value={githubReference}
                    onChange={(event) => setGithubReference(event.target.value)}
                  />
                  <Textarea
                    className="min-h-24"
                    value={githubPrompt}
                    onChange={(event) => setGithubPrompt(event.target.value)}
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPrDialogOpen(true)}
                      disabled={!selectedProject}
                    >
                      <GitPullRequestIcon className="size-3.5" />
                      Resolve PR
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void startIssueThread()}
                      disabled={!selectedProject}
                    >
                      <GitHubIcon className="size-3.5" />
                      Start Thread
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <GitForkIcon className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <h2 className="text-sm font-semibold">Worktree Task Isolation</h2>
                    <p className="text-muted-foreground text-xs">
                      Create a separate branch and open a thread pinned to that worktree.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      placeholder="Base branch"
                      value={baseBranch}
                      onChange={(event) => setBaseBranch(event.target.value)}
                    />
                    <Input
                      placeholder="New branch, e.g. codex/carrier-card-proof"
                      value={newBranch}
                      onChange={(event) => setNewBranch(event.target.value)}
                    />
                  </div>
                  <Input
                    placeholder="Optional worktree path"
                    value={worktreePath}
                    onChange={(event) => setWorktreePath(event.target.value)}
                  />
                  <Textarea
                    className="min-h-24"
                    value={worktreePrompt}
                    onChange={(event) => setWorktreePrompt(event.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void createIsolatedWorktree()}
                      disabled={!selectedProject || createWorktreeMutation.isPending}
                    >
                      {createWorktreeMutation.isPending ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <GitForkIcon className="size-3.5" />
                      )}
                      Create Worktree Thread
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Diff + Commit / PR</h2>
                  <p className="text-muted-foreground text-xs">
                    Review current repo state and run the same commit, push, and PR actions
                    available in chat.
                  </p>
                </div>
                <GitActionsControl gitCwd={selectedCwd} activeThreadId={null} />
              </div>
              <div className="mt-4">
                <RepoStatusBlock
                  status={gitStatusQuery.data ?? null}
                  isLoading={gitStatusQuery.isPending}
                />
              </div>
              {gitStatusQuery.data?.workingTree.files.length ? (
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                  <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] border-b border-border bg-muted/24 px-3 py-2 text-muted-foreground text-xs">
                    <span>File</span>
                    <span className="text-right">Add</span>
                    <span className="text-right">Del</span>
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {gitStatusQuery.data.workingTree.files.map((file) => (
                      <div
                        key={file.path}
                        className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-b-0"
                      >
                        <span className="truncate">{file.path}</span>
                        <span className="text-right text-success-foreground">
                          +{file.insertions}
                        </span>
                        <span className="text-right text-destructive-foreground">
                          -{file.deletions}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              <pre
                className={cn(
                  "mt-4 max-h-96 overflow-auto rounded-lg border border-border bg-muted/18 p-3 text-[11px] leading-5",
                  workingTreeDiffQuery.data?.patch ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {workingTreeDiffQuery.isFetching
                  ? "Loading diff..."
                  : workingTreeDiffQuery.data?.patch || "No working tree diff."}
              </pre>
            </section>
          </div>
        </div>
      </div>

      <PullRequestThreadDialog
        open={prDialogOpen}
        cwd={selectedCwd}
        initialReference={githubReference}
        onOpenChange={setPrDialogOpen}
        onPrepared={async (input) => {
          if (!selectedProject) return;
          const envMode: ThreadEnvironmentMode = input.worktreePath ? "worktree" : "local";
          const threadId = await handleNewThread(selectedProject.id, {
            fresh: true,
            provider,
            envMode,
            branch: input.branch,
            worktreePath: input.worktreePath,
            lastKnownPr: input.pullRequest,
          });
          useComposerDraftStore
            .getState()
            .setPrompt(threadId, makePullRequestPrompt(input.pullRequest));
        }}
      />
    </SidebarInset>
  );
}
