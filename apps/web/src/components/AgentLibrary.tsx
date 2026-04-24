// FILE: AgentLibrary.tsx
// Purpose: Dashboard for saved agent definitions — list, edit, run, view history.
// Layer: Route-level screen
// Exports: AgentLibrary

import {
  DEFAULT_MODEL_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
  ProjectId,
  type AgentDefinition,
  type ModelSelection,
  type ProviderKind,
  type ThreadEnvironmentMode,
} from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useStore } from "~/store";
import {
  agentCreateMutationOptions,
  agentDeleteMutationOptions,
  agentQueryKeys,
  agentRunNowMutationOptions,
  agentRunsQueryOptions,
  agentUpdateMutationOptions,
  agentsListQueryOptions,
} from "~/lib/agentsReactQuery";
import { cn } from "~/lib/utils";
import { toastManager } from "./ui/toast";
import { SidebarHeaderTrigger, SidebarInset } from "./ui/sidebar";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { PlayIcon, PlusIcon, Trash2 } from "~/lib/icons";

const PROVIDER_ORDER: ReadonlyArray<ProviderKind> = [
  "claudeAgent",
  "codex",
  "gemini",
  "opencode",
];

const ENV_MODES: ReadonlyArray<ThreadEnvironmentMode> = ["local", "worktree"];

type DraftAgent = {
  projectId: string;
  name: string;
  description: string;
  provider: ProviderKind;
  model: string;
  systemPrompt: string;
  taskTemplate: string;
  toolAllowlist: string; // comma-separated for input
  cwd: string;
  envMode: ThreadEnvironmentMode;
  enabled: boolean;
};

const emptyDraft: DraftAgent = {
  projectId: "",
  name: "",
  description: "",
  provider: "claudeAgent",
  model: String(DEFAULT_MODEL_BY_PROVIDER.claudeAgent),
  systemPrompt: "",
  taskTemplate: "",
  toolAllowlist: "",
  cwd: "",
  envMode: "local",
  enabled: true,
};

function agentToDraft(agent: AgentDefinition): DraftAgent {
  return {
    projectId: agent.projectId,
    name: agent.name,
    description: agent.description ?? "",
    provider: agent.provider,
    model: agent.modelSelection.model,
    systemPrompt: agent.systemPrompt ?? "",
    taskTemplate: agent.taskTemplate,
    toolAllowlist: agent.toolAllowlist.join(", "),
    cwd: agent.cwd ?? "",
    envMode: agent.envMode,
    enabled: agent.enabled,
  };
}

function buildModelSelection(provider: ProviderKind, model: string): ModelSelection {
  return { provider, model } as ModelSelection;
}

function parseToolAllowlist(input: string): ReadonlyArray<string> {
  return input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function AgentLibrary() {
  const queryClient = useQueryClient();
  const agentsQuery = useQuery(agentsListQueryOptions());
  const projects = useStore((state) => state.projects);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftAgent | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const agents = useMemo(() => agentsQuery.data ?? [], [agentsQuery.data]);
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: agentQueryKeys.list() });

  const createMutation = useMutation({
    ...agentCreateMutationOptions(),
    onSuccess: (agent) => {
      invalidateList();
      setSelectedAgentId(agent.id);
      setIsCreating(false);
      setDraft(agentToDraft(agent));
      toastManager.add({ type: "success", title: `Created agent "${agent.name}"` });
    },
    onError: (err) =>
      toastManager.add({ type: "error", title: "Create failed", description: err.message }),
  });

  const updateMutation = useMutation({
    ...agentUpdateMutationOptions(),
    onSuccess: (agent) => {
      invalidateList();
      toastManager.add({ type: "success", title: `Saved "${agent.name}"` });
    },
    onError: (err) =>
      toastManager.add({ type: "error", title: "Save failed", description: err.message }),
  });

  const deleteMutation = useMutation({
    ...agentDeleteMutationOptions(),
    onSuccess: () => {
      invalidateList();
      setSelectedAgentId(null);
      setDraft(null);
      toastManager.add({ type: "success", title: "Agent deleted" });
    },
    onError: (err) =>
      toastManager.add({ type: "error", title: "Delete failed", description: err.message }),
  });

  const runNowMutation = useMutation({
    ...agentRunNowMutationOptions(),
    onSuccess: (result) => {
      toastManager.add({
        type: "success",
        title: `Run started — thread ${result.threadId.slice(0, 8)}`,
      });
    },
    onError: (err) =>
      toastManager.add({ type: "error", title: "Run failed", description: err.message }),
  });

  const startNewAgent = () => {
    setIsCreating(true);
    setSelectedAgentId(null);
    setDraft({ ...emptyDraft });
  };

  const selectAgent = (agent: AgentDefinition) => {
    setSelectedAgentId(agent.id);
    setIsCreating(false);
    setDraft(agentToDraft(agent));
  };

  const saveDraft = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      toastManager.add({ type: "error", title: "Name is required" });
      return;
    }
    if (!draft.projectId) {
      toastManager.add({ type: "error", title: "Project is required" });
      return;
    }
    if (!draft.taskTemplate.trim()) {
      toastManager.add({ type: "error", title: "Task template is required" });
      return;
    }

    const modelSelection = buildModelSelection(draft.provider, draft.model.trim());
    const toolAllowlist = parseToolAllowlist(draft.toolAllowlist);
    const projectId = ProjectId.makeUnsafe(draft.projectId);

    if (isCreating) {
      createMutation.mutate({
        projectId,
        name: draft.name.trim(),
        ...(draft.description ? { description: draft.description } : {}),
        provider: draft.provider,
        modelSelection,
        ...(draft.systemPrompt ? { systemPrompt: draft.systemPrompt } : {}),
        taskTemplate: draft.taskTemplate,
        toolAllowlist,
        ...(draft.cwd ? { cwd: draft.cwd } : {}),
        envMode: draft.envMode,
        enabled: draft.enabled,
      });
    } else if (selectedAgent) {
      updateMutation.mutate({
        id: selectedAgent.id,
        projectId,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        provider: draft.provider,
        modelSelection,
        systemPrompt: draft.systemPrompt || null,
        taskTemplate: draft.taskTemplate,
        toolAllowlist,
        cwd: draft.cwd.trim() || null,
        envMode: draft.envMode,
        enabled: draft.enabled,
      });
    }
  };

  const deleteSelected = () => {
    if (!selectedAgent) return;
    if (!window.confirm(`Delete agent "${selectedAgent.name}"?`)) return;
    deleteMutation.mutate({ id: selectedAgent.id });
  };

  const runSelected = () => {
    if (!selectedAgent) return;
    runNowMutation.mutate({ agentId: selectedAgent.id });
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6 h-12">
          <SidebarHeaderTrigger className="size-7 shrink-0" />
          <h1 className="text-[15px] font-semibold">Agents</h1>
          <div className="flex-1" />
          <Button size="sm" onClick={startNewAgent}>
            <PlusIcon className="size-3.5" />
            New agent
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ── Agent list ── */}
          <aside className="w-64 shrink-0 border-r border-border overflow-y-auto">
            {agentsQuery.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : agents.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No agents yet. Click "New agent" to create one.
              </div>
            ) : (
              <ul className="py-2">
                {agents.map((agent) => (
                  <li key={agent.id}>
                    <button
                      type="button"
                      onClick={() => selectAgent(agent)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left hover:bg-muted/50",
                        selectedAgentId === agent.id && "bg-muted",
                      )}
                    >
                      <span className="text-sm font-medium">{agent.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {PROVIDER_DISPLAY_NAMES[agent.provider]} · {agent.modelSelection.model}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* ── Editor ── */}
          <section className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            {!draft ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select an agent or create a new one.
              </div>
            ) : (
              <AgentEditor
                draft={draft}
                projects={projects}
                onChange={(next) => setDraft(next)}
                onSave={saveDraft}
                saving={createMutation.isPending || updateMutation.isPending}
                {...(isCreating ? {} : { onDelete: deleteSelected, onRun: runSelected })}
                deleting={deleteMutation.isPending}
                running={runNowMutation.isPending}
              />
            )}
            {selectedAgent && !isCreating ? <AgentRunHistory agentId={selectedAgent.id} /> : null}
          </section>
        </div>
      </div>
    </SidebarInset>
  );
}

// ── Editor form ─────────────────────────────────────────────────────

function AgentEditor({
  draft,
  projects,
  onChange,
  onSave,
  saving,
  onDelete,
  deleting,
  onRun,
  running,
}: {
  draft: DraftAgent;
  projects: ReadonlyArray<{ id: string; name: string }>;
  onChange: (next: DraftAgent) => void;
  onSave: () => void;
  saving: boolean;
  onDelete?: () => void;
  deleting?: boolean;
  onRun?: () => void;
  running?: boolean;
}) {
  const update = <K extends keyof DraftAgent>(key: K, value: DraftAgent[K]) =>
    onChange({ ...draft, [key]: value });

  const setProvider = (provider: ProviderKind) => {
    onChange({
      ...draft,
      provider,
      model: String(DEFAULT_MODEL_BY_PROVIDER[provider]),
    });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <Field label="Name">
        <Input value={draft.name} onChange={(e) => update("name", e.target.value)} />
      </Field>

      <Field label="Description">
        <Input
          value={draft.description}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Optional — one line describing what this agent does"
        />
      </Field>

      <Field label="Project" hint="The project this agent runs against.">
        {projects.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No projects yet. Add a project to your sidebar first.
          </div>
        ) : (
          <Select value={draft.projectId} onValueChange={(v) => update("projectId", v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project…" />
            </SelectTrigger>
            <SelectPopup>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Provider">
          <Select value={draft.provider} onValueChange={(v) => setProvider(v as ProviderKind)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {PROVIDER_ORDER.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  {PROVIDER_DISPLAY_NAMES[provider]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>

        <Field label="Model">
          <Input value={draft.model} onChange={(e) => update("model", e.target.value)} />
        </Field>
      </div>

      <Field label="System prompt append">
        <textarea
          className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={draft.systemPrompt}
          onChange={(e) => update("systemPrompt", e.target.value)}
          placeholder="Optional — appended to the provider's base system prompt on every run"
        />
      </Field>

      <Field label="Task template">
        <textarea
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
          value={draft.taskTemplate}
          onChange={(e) => update("taskTemplate", e.target.value)}
          placeholder="What the agent should do. Supports {{variable}} substitution."
        />
      </Field>

      <Field label="Tool allowlist" hint="Comma-separated MCP tool names. Empty = inherit defaults.">
        <Input
          value={draft.toolAllowlist}
          onChange={(e) => update("toolAllowlist", e.target.value)}
          placeholder="Read, Grep, Bash"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Working directory" hint="Blank = inherit from project">
          <Input value={draft.cwd} onChange={(e) => update("cwd", e.target.value)} />
        </Field>

        <Field label="Environment mode">
          <Select
            value={draft.envMode}
            onValueChange={(v) => update("envMode", v as ThreadEnvironmentMode)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {ENV_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
        <div>
          <div className="text-sm font-medium">Enabled</div>
          <div className="text-xs text-muted-foreground">Disabled agents won't run.</div>
        </div>
        <Switch checked={draft.enabled} onCheckedChange={(v) => update("enabled", v)} />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {onRun ? (
          <Button variant="secondary" onClick={onRun} disabled={running}>
            <PlayIcon className="size-3.5" />
            {running ? "Starting…" : "Run now"}
          </Button>
        ) : null}
        <div className="flex-1" />
        {onDelete ? (
          <Button variant="ghost" onClick={onDelete} disabled={deleting}>
            <Trash2 className="size-3.5" />
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

// ── Run history ──────────────────────────────────────────────────────

function AgentRunHistory({ agentId }: { agentId: string }) {
  const runsQuery = useQuery(agentRunsQueryOptions({ agentId, limit: 20 }));
  const runs = runsQuery.data ?? [];

  return (
    <div className="mx-auto mt-10 max-w-2xl">
      <h2 className="mb-2 text-sm font-semibold">Recent runs</h2>
      {runsQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : runs.length === 0 ? (
        <div className="text-sm text-muted-foreground">No runs yet.</div>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {runs.map((run) => (
            <li key={run.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  run.status === "complete" && "bg-emerald-500",
                  run.status === "failed" && "bg-rose-500",
                  run.status === "running" && "bg-sky-500",
                  run.status === "queued" && "bg-amber-500",
                  run.status === "cancelled" && "bg-muted-foreground",
                )}
              />
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(run.startedAt).toLocaleString()}
              </span>
              <span className="flex-1 capitalize">{run.status}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {run.threadId.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
