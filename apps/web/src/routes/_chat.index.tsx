// FILE: _chat.index.tsx
// Purpose: Open or resume the home-chat draft using the same bootstrap path as standard threads.
// Layer: Routing
// Depends on: shared new-chat handler so "/" stays a thin alias instead of a special chat surface.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";

import { SplashScreen } from "../components/SplashScreen";
import { readSidebarUiState } from "../components/Sidebar.uiState";
import { useHandleNewChat } from "../hooks/useHandleNewChat";
import { createSidebarDisplayThreadsSelector } from "../storeSelectors";
import { useStore } from "../store";
import { resolveChatIndexResumeThread } from "./-chatIndexRoute.logic";

function ChatIndexRouteView() {
  const { handleNewChat } = useHandleNewChat();
  const navigate = useNavigate();
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const threads = useStore(useMemo(() => createSidebarDisplayThreadsSelector(), []));
  const [attempt, setAttempt] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    let cancelled = false;
    setErrorMessage(null);

    void (async () => {
      const resumeRoute = resolveChatIndexResumeThread({
        lastThreadRoute: readSidebarUiState().lastThreadRoute,
        threads,
      });
      if (resumeRoute) {
        await navigate({
          to: "/$threadId",
          params: { threadId: ThreadId.makeUnsafe(resumeRoute.threadId) },
          replace: true,
          search: () => ({
            splitViewId: resumeRoute.splitViewId,
          }),
        });
        return;
      }

      const result = await handleNewChat({ fresh: true });
      if (cancelled || result.ok) {
        return;
      }
      setErrorMessage(result.error);
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, handleNewChat, navigate, threads, threadsHydrated]);

  return (
    <SplashScreen
      errorMessage={errorMessage}
      onRetry={errorMessage ? () => setAttempt((value) => value + 1) : null}
    />
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
