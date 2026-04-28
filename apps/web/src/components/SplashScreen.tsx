// FILE: SplashScreen.tsx
// Purpose: Render the branded startup face while the app is still booting a route or session.
// Layer: Shared app loading presentation

import { APP_COMPACT_NAME, APP_MARK_ALT } from "~/branding";

export function SplashScreen({
  errorMessage,
  onRetry,
}: {
  errorMessage?: string | null;
  onRetry?: (() => void) | null;
}) {
  const showRetry = Boolean(errorMessage && onRetry);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5 select-none">
        <div
          aria-label={`${APP_COMPACT_NAME} splash screen`}
          className="flex size-24 items-center justify-center rounded-[22px] border border-border/50 bg-background/80 shadow-[0_1px_2px_rgba(0,0,0,0.12),0_12px_32px_rgba(0,0,0,0.18)]"
        >
          <img
            alt={APP_MARK_ALT}
            className="size-14 rounded-[14px] object-cover"
            draggable={false}
            src="/dpcode.png"
          />
        </div>

        {errorMessage ? (
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <span className="text-sm text-muted-foreground/75">{errorMessage}</span>
            {showRetry ? (
              <button
                type="button"
                className="rounded-md border border-border/70 px-3 py-1.5 text-sm text-foreground/85 transition-colors hover:bg-[var(--sidebar-accent)]"
                onClick={onRetry ?? undefined}
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
