// FILE: DiffSummaryCard.logic.ts
// Purpose: Pure derivation helpers for compact diff summary cards in chat.
// Layer: Web chat presentation helpers
// Exports: deriveDiffSummaryCardState

import type { GitStatusResult } from "@t3tools/contracts";
import type { TurnDiffFileChange, TurnDiffSummary } from "../../types";

const MAX_CARD_FILES = 20;

export type DiffSummaryCardStatus = "empty" | "loading" | "ready" | "error";

export interface DiffSummaryCardFile {
  path: string;
  additions?: number;
  deletions?: number;
}

export interface DiffSummaryCardState {
  status: DiffSummaryCardStatus;
  title: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  files: DiffSummaryCardFile[];
  summary: string | null;
  errorMessage: string | null;
}

export function deriveWorkingTreeDiffSummaryCardState(input: {
  status: GitStatusResult | null | undefined;
  patch: string | null | undefined;
  summary: string | null | undefined;
  isPatchLoading?: boolean;
  isSummaryLoading?: boolean;
  error?: unknown;
}): DiffSummaryCardState {
  const files =
    input.status?.workingTree.files.map((file) => ({
      path: file.path,
      additions: file.insertions,
      deletions: file.deletions,
    })) ?? [];
  const hasChanges = Boolean(input.status?.hasWorkingTreeChanges) || files.length > 0;
  const hasPatch = Boolean(input.patch?.trim());
  return finalizeDiffSummaryCardState({
    title: "Working tree changes",
    files,
    filesChanged: files.length,
    insertions: input.status?.workingTree.insertions ?? sum(files, "additions"),
    deletions: input.status?.workingTree.deletions ?? sum(files, "deletions"),
    summary: input.summary,
    isLoading: Boolean(input.isPatchLoading || input.isSummaryLoading),
    error: input.error,
    isEmpty: !hasChanges && !hasPatch,
  });
}

export function deriveTurnDiffSummaryCardState(input: {
  turnSummary: TurnDiffSummary | null | undefined;
  summary?: string | null | undefined;
  isSummaryLoading?: boolean;
  error?: unknown;
}): DiffSummaryCardState {
  const files = (input.turnSummary?.files ?? []).map(turnFileToCardFile);
  return finalizeDiffSummaryCardState({
    title: files.length === 1 ? "1 file changed" : `${files.length} files changed`,
    files,
    filesChanged: files.length,
    insertions: sum(files, "additions"),
    deletions: sum(files, "deletions"),
    summary: input.summary,
    isLoading: Boolean(input.isSummaryLoading),
    error: input.error,
    isEmpty: files.length === 0,
  });
}

function finalizeDiffSummaryCardState(input: {
  title: string;
  files: DiffSummaryCardFile[];
  filesChanged?: number;
  insertions: number;
  deletions: number;
  summary: string | null | undefined;
  isLoading?: boolean;
  error?: unknown;
  isEmpty: boolean;
}): DiffSummaryCardState {
  const errorMessage = errorMessageFromUnknown(input.error);
  const summary = input.summary?.trim() ? input.summary.trim() : null;
  const status: DiffSummaryCardStatus = input.isEmpty
    ? "empty"
    : errorMessage
      ? "error"
      : input.isLoading
        ? "loading"
        : "ready";
  return {
    status,
    title: input.title,
    filesChanged: input.filesChanged ?? input.files.length,
    insertions: input.insertions,
    deletions: input.deletions,
    files: input.files.slice(0, MAX_CARD_FILES),
    summary,
    errorMessage,
  };
}

function turnFileToCardFile(file: TurnDiffFileChange): DiffSummaryCardFile {
  return {
    path: file.path,
    ...(file.additions !== undefined ? { additions: file.additions } : {}),
    ...(file.deletions !== undefined ? { deletions: file.deletions } : {}),
  };
}

function sum(files: ReadonlyArray<DiffSummaryCardFile>, field: "additions" | "deletions"): number {
  return files.reduce((total, file) => total + (file[field] ?? 0), 0);
}

function errorMessageFromUnknown(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Diff summary unavailable";
}
