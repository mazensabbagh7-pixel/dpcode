import type {
  AgentCreateInput,
  AgentDefinition,
  AgentListRunsInput,
  AgentRun,
  AgentRunNowInput,
  AgentRunNowResult,
  AgentUpdateInput,
} from "@t3tools/contracts";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { ensureNativeApi } from "~/nativeApi";

export const agentQueryKeys = {
  all: ["agents"] as const,
  list: () => [...agentQueryKeys.all, "list"] as const,
  runs: (agentId: string, limit: number | undefined) =>
    [...agentQueryKeys.all, "runs", agentId, limit ?? null] as const,
};

const AGENT_LIST_STALE_TIME = 15_000;
const AGENT_RUNS_STALE_TIME = 5_000;

export function agentsListQueryOptions() {
  return queryOptions<ReadonlyArray<AgentDefinition>>({
    queryKey: agentQueryKeys.list(),
    queryFn: async () => ensureNativeApi().agents.list(),
    staleTime: AGENT_LIST_STALE_TIME,
  });
}

export function agentRunsQueryOptions(input: AgentListRunsInput) {
  return queryOptions<ReadonlyArray<AgentRun>>({
    queryKey: agentQueryKeys.runs(input.agentId, input.limit),
    queryFn: async () => ensureNativeApi().agents.listRuns(input),
    staleTime: AGENT_RUNS_STALE_TIME,
    enabled: input.agentId.length > 0,
  });
}

export const agentCreateMutationOptions = () =>
  mutationOptions<AgentDefinition, Error, AgentCreateInput>({
    mutationFn: async (input) => ensureNativeApi().agents.create(input),
  });

export const agentUpdateMutationOptions = () =>
  mutationOptions<AgentDefinition, Error, AgentUpdateInput>({
    mutationFn: async (input) => ensureNativeApi().agents.update(input),
  });

export const agentDeleteMutationOptions = () =>
  mutationOptions<{ id: string }, Error, { id: string }>({
    mutationFn: async (input) => ensureNativeApi().agents.delete(input),
  });

export const agentRunNowMutationOptions = () =>
  mutationOptions<AgentRunNowResult, Error, AgentRunNowInput>({
    mutationFn: async (input) => ensureNativeApi().agents.runNow(input),
  });
