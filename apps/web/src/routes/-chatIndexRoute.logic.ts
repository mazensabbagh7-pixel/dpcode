import type { SidebarLastThreadRoute } from "../components/Sidebar.logic";
import type { SidebarThreadSummary } from "../types";

export type ChatIndexResumeThreadRoute = {
  threadId: string;
  splitViewId?: string | undefined;
};

function getThreadResumeTime(thread: SidebarThreadSummary): number {
  const timestamp = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? 0 : value;
}

export function resolveChatIndexResumeThread(input: {
  lastThreadRoute: SidebarLastThreadRoute | null;
  threads: readonly SidebarThreadSummary[];
}): ChatIndexResumeThreadRoute | null {
  const availableThreadIds = new Set(input.threads.map((thread) => String(thread.id)));
  if (input.lastThreadRoute && availableThreadIds.has(input.lastThreadRoute.threadId)) {
    return input.lastThreadRoute;
  }

  const latestThread = input.threads.reduce<SidebarThreadSummary | null>((latest, thread) => {
    if (!latest) {
      return thread;
    }
    return getThreadResumeTime(thread) > getThreadResumeTime(latest) ? thread : latest;
  }, null);

  return latestThread ? { threadId: latestThread.id } : null;
}
