// FILE: DiffSummaryCard.tsx
// Purpose: Compact summary card for turn and working-tree diffs.
// Layer: Web chat presentation component
// Exports: DiffSummaryCard

import { memo } from "react";
import { DiffStatLabel } from "./DiffStatLabel";
import { FileEntryIcon } from "./FileEntryIcon";
import type { DiffSummaryCardState } from "./DiffSummaryCard.logic";
import { cn } from "~/lib/utils";

const MAX_VISIBLE_FILES = 5;

export const DiffSummaryCard = memo(function DiffSummaryCard(props: {
  state: DiffSummaryCardState;
  onOpenDiff?: () => void;
  onOpenFile?: (filePath: string) => void;
  expanded?: boolean;
  onToggleExpanded?: () => void;
  canUndo?: boolean;
  onUndo?: () => void;
  theme: "light" | "dark";
  fontSizePx?: number;
}) {
  const {
    state,
    onOpenDiff,
    onOpenFile,
    expanded = true,
    onToggleExpanded,
    canUndo = false,
    onUndo,
    theme,
    fontSizePx,
  } = props;
  if (state.status === "empty") return null;
  const visibleFiles = expanded ? state.files.slice(0, MAX_VISIBLE_FILES) : [];
  const hiddenCount = Math.max(0, state.files.length - visibleFiles.length);
  const textStyle = fontSizePx ? { fontSize: `${fontSizePx}px` } : undefined;
  const statText =
    state.insertions + state.deletions > 0 ? (
      <DiffStatLabel additions={state.insertions} deletions={state.deletions} />
    ) : null;

  return (
    <div className="mt-5 overflow-hidden rounded-xl border border-[color:var(--color-border-light)] bg-[var(--composer-surface)] shadow-sm shadow-black/[0.03]">
      <div className="flex items-start justify-between gap-3 border-b border-[color:var(--color-border-light)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium text-foreground/92" style={textStyle}>
              {state.title}
            </span>
            {statText ? (
              <span className="font-chat-code text-muted-foreground/80" style={textStyle}>
                {statText}
              </span>
            ) : null}
            {state.status === "loading" ? (
              <span className="text-[11px] text-muted-foreground/45">Summarizing…</span>
            ) : null}
          </div>
          {state.summary ? (
            <p className="mt-1 line-clamp-3 text-muted-foreground/70" style={textStyle}>
              {state.summary}
            </p>
          ) : state.errorMessage ? (
            <p className="mt-1 text-muted-foreground/55" style={textStyle}>
              {state.errorMessage}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onOpenDiff ? (
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              style={textStyle}
              onClick={onOpenDiff}
            >
              Open diff
            </button>
          ) : null}
          {canUndo ? (
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              style={textStyle}
              onClick={onUndo}
            >
              Undo
            </button>
          ) : null}
          {onToggleExpanded ? (
            <button
              type="button"
              className="text-muted-foreground/60 transition-colors hover:text-foreground"
              aria-expanded={expanded}
              onClick={onToggleExpanded}
            >
              {expanded ? "Hide" : "Show"}
            </button>
          ) : null}
        </div>
      </div>
      {expanded && visibleFiles.length > 0 ? (
        <div>
          {visibleFiles.map((file) => {
            const canOpen = Boolean(onOpenFile);
            return (
              <button
                key={file.path}
                type="button"
                className={cn(
                  "group flex w-full items-center gap-2 border-t border-[color:var(--color-border-light)] px-3 py-1.5 text-left first:border-t-0 transition-colors",
                  canOpen
                    ? "hover:bg-[var(--color-background-button-secondary-hover)]"
                    : "cursor-default",
                )}
                disabled={!canOpen}
                title={file.path}
                onClick={() => onOpenFile?.(file.path)}
              >
                <FileEntryIcon
                  pathValue={file.path}
                  kind="file"
                  theme={theme}
                  className="size-4 shrink-0 opacity-50 dark:opacity-30"
                />
                <span
                  className="font-chat-code truncate font-normal underline-offset-2 group-hover:underline group-focus-visible:underline"
                  style={textStyle}
                >
                  {file.path}
                </span>
                {(file.additions ?? 0) + (file.deletions ?? 0) > 0 ? (
                  <span className="font-chat-code ml-auto shrink-0 tabular-nums" style={textStyle}>
                    <DiffStatLabel
                      additions={file.additions ?? 0}
                      deletions={file.deletions ?? 0}
                    />
                  </span>
                ) : null}
              </button>
            );
          })}
          {hiddenCount > 0 ? (
            <div className="px-3 py-1.5 text-xs text-muted-foreground/50">
              +{hiddenCount} more files
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
