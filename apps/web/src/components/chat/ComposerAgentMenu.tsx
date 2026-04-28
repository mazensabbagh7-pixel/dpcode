// FILE: ComposerAgentMenu.tsx
// Purpose: Composer-level access to saved agent definitions and their real run flow.
// Layer: Chat composer presentation + orchestration bridge

import { PROVIDER_DISPLAY_NAMES, type AgentDefinition, type ProjectId } from "@t3tools/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { memo, useMemo } from "react";

import {
  agentQueryKeys,
  agentRunNowMutationOptions,
  agentsListQueryOptions,
} from "~/lib/agentsReactQuery";
import { BotIcon, Loader2Icon, SettingsIcon } from "~/lib/icons";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";

const MAX_VISIBLE_AGENTS = 8;

function formatAgentMeta(agent: AgentDefinition): string {
  const providerLabel = PROVIDER_DISPLAY_NAMES[agent.provider] ?? agent.provider;
  const toolCount = agent.toolAllowlist.length;
  const toolLabel =
    toolCount === 0 ? "default tools" : `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`;
  return `${providerLabel} / ${agent.modelSelection.model} / ${toolLabel}`;
}

export const ComposerAgentMenu = memo(function ComposerAgentMenu(props: {
  activeProjectId: ProjectId | null;
  compact?: boolean;
  onRunStarted?: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const agentsQuery = useQuery(agentsListQueryOptions());

  const visibleAgents = useMemo(() => {
    const agents = (agentsQuery.data ?? []).filter((agent) => agent.enabled);
    const activeProjectId = props.activeProjectId;
    return agents
      .slice()
      .sort((left, right) => {
        const leftMatches = activeProjectId !== null && left.projectId === activeProjectId;
        const rightMatches = activeProjectId !== null && right.projectId === activeProjectId;
        if (leftMatches !== rightMatches) return leftMatches ? -1 : 1;
        return left.name.localeCompare(right.name);
      })
      .slice(0, MAX_VISIBLE_AGENTS);
  }, [agentsQuery.data, props.activeProjectId]);

  const runNowMutation = useMutation({
    ...agentRunNowMutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: agentQueryKeys.all });
      const snapshot = await ensureNativeApi().orchestration.getSnapshot();
      syncServerReadModel(snapshot);
      props.onRunStarted?.();
      toastManager.add({
        type: "success",
        title: "Agent run started",
        description: `Thread ${result.threadId.slice(0, 8)} is open.`,
      });
      await navigate({
        to: "/$threadId",
        params: { threadId: result.threadId },
      });
    },
    onError: (err) => {
      toastManager.add({
        type: "error",
        title: "Agent run failed",
        description: err.message,
      });
    },
  });

  const isBusy = runNowMutation.isPending;
  const hasAgents = visibleAgents.length > 0;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="chrome"
            className="min-w-0 shrink-0 whitespace-nowrap px-2 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] sm:px-3"
            type="button"
            aria-label="Saved agents"
            disabled={isBusy}
          />
        }
      >
        {isBusy ? (
          <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <BotIcon aria-hidden="true" className="size-3.5" />
        )}
        <span className={props.compact ? "sr-only" : "sr-only sm:not-sr-only"}>Agents</span>
      </MenuTrigger>
      <MenuPopup align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <MenuGroupLabel>Run saved agent</MenuGroupLabel>
        {agentsQuery.isLoading ? (
          <MenuItem disabled>
            <Loader2Icon className="size-4 animate-spin" />
            Loading agents
          </MenuItem>
        ) : hasAgents ? (
          visibleAgents.map((agent) => (
            <MenuItem
              key={agent.id}
              className="items-start py-2"
              disabled={isBusy}
              onClick={() => {
                runNowMutation.mutate({ agentId: agent.id });
              }}
            >
              <BotIcon className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{agent.name}</span>
                <span className="block truncate text-[length:var(--app-font-size-ui-xs,10px)] text-muted-foreground">
                  {formatAgentMeta(agent)}
                </span>
              </span>
            </MenuItem>
          ))
        ) : (
          <MenuItem disabled>
            <BotIcon className="size-4" />
            No saved agents yet
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onClick={() => void navigate({ to: "/agents" })}>
          <SettingsIcon className="size-4" />
          Manage agents
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
});
