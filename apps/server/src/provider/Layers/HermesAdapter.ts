import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  EventId,
  RuntimeItemId,
  type ProviderRuntimeEvent,
  type ProviderSendTurnInput,
  type ProviderSession,
  type ProviderSessionStartInput,
  type ProviderTurnStartResult,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { HermesAdapter, type HermesAdapterShape } from "../Services/HermesAdapter.ts";

const PROVIDER = "hermes" as const;
export const DEFAULT_HERMES_SSH_HOST = "mac-mini";
export const DEFAULT_HERMES_HOME = "~/.hermes-staging";
export const DEFAULT_HERMES_REMOTE_CWD = "~/.hermes-staging/hermes-agent";
export const DEFAULT_HERMES_COMMAND = "./venv/bin/hermes";
const HERMES_SOURCE = "mazen-code";

interface HermesTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface HermesSessionContext {
  session: ProviderSession;
  readonly turns: HermesTurnSnapshot[];
  readonly sshHost?: string | undefined;
  readonly remoteCwd?: string | undefined;
  readonly command?: string | undefined;
  activeProcess: ChildProcessWithoutNullStreams | undefined;
  stopped: boolean;
}

export interface HermesRemoteCommandInput {
  readonly prompt: string;
  readonly sshHost?: string | undefined;
  readonly remoteCwd?: string | undefined;
  readonly command?: string | undefined;
  readonly model?: string | undefined;
  readonly resumeSessionId?: string | undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function shellQuoteRemotePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "~" || trimmed === "$HOME" || trimmed === "${HOME}") {
    return "$HOME";
  }
  for (const prefix of ["~/", "$HOME/", "${HOME}/"] as const) {
    if (trimmed.startsWith(prefix)) {
      const relativePath = trimmed.slice(prefix.length);
      return relativePath.length > 0 ? `$HOME/${shellQuote(relativePath)}` : "$HOME";
    }
  }
  return shellQuote(trimmed);
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeHermesModel(model: string | undefined): string | undefined {
  const normalized = trimToUndefined(model);
  return normalized === undefined || normalized === "hermes-default" ? undefined : normalized;
}

function sessionIdFromResumeCursor(resumeCursor: unknown): string | undefined {
  if (!resumeCursor || typeof resumeCursor !== "object") {
    return undefined;
  }
  const record = resumeCursor as Record<string, unknown>;
  return typeof record.sessionId === "string" && record.sessionId.trim().length > 0
    ? record.sessionId.trim()
    : undefined;
}

export function extractHermesSessionId(output: string): string | undefined {
  const match = output.match(/(?:^|\n)session_id:\s*([^\s]+)/i);
  return match?.[1]?.trim();
}

export function buildHermesRemoteShellCommand(input: HermesRemoteCommandInput): string {
  const remoteCwd = trimToUndefined(input.remoteCwd) ?? DEFAULT_HERMES_REMOTE_CWD;
  const command = trimToUndefined(input.command) ?? DEFAULT_HERMES_COMMAND;
  const args = [
    "chat",
    "--query",
    input.prompt,
    "--quiet",
    "--source",
    HERMES_SOURCE,
    "--accept-hooks",
    "--checkpoints",
  ];
  const model = normalizeHermesModel(input.model);
  if (model) {
    args.push("--model", model);
  }
  const resumeSessionId = trimToUndefined(input.resumeSessionId);
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  return [
    "cd",
    shellQuoteRemotePath(remoteCwd),
    "&&",
    `HERMES_HOME=${shellQuoteRemotePath(DEFAULT_HERMES_HOME)}`,
    shellQuote(command),
    ...args.map(shellQuote),
  ].join(" ");
}

export function buildHermesSshArgs(input: HermesRemoteCommandInput): string[] {
  const sshHost = trimToUndefined(input.sshHost) ?? DEFAULT_HERMES_SSH_HOST;
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    sshHost,
    buildHermesRemoteShellCommand(input),
  ];
}

function truncateDetail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 2000) {
    return trimmed;
  }
  return `${trimmed.slice(0, 2000)}...`;
}

type HermesRuntimeEventInput = Omit<
  ProviderRuntimeEvent,
  "eventId" | "provider" | "threadId" | "createdAt"
>;

function makeEvent(
  context: HermesSessionContext,
  input: HermesRuntimeEventInput,
): ProviderRuntimeEvent {
  const event = {
    eventId: EventId.makeUnsafe(randomUUID()),
    provider: PROVIDER,
    threadId: context.session.threadId,
    createdAt: nowIso(),
    ...input,
  };
  return event as ProviderRuntimeEvent;
}

function offerEvent(
  queue: Queue.Queue<ProviderRuntimeEvent>,
  context: HermesSessionContext,
  event: Parameters<typeof makeEvent>[1],
): void {
  void Effect.runPromise(Queue.offer(queue, makeEvent(context, event)));
}

function updateSession(
  context: HermesSessionContext,
  patch: Partial<ProviderSession>,
): ProviderSession {
  context.session = {
    ...context.session,
    ...patch,
    updatedAt: nowIso(),
  };
  return context.session;
}

function ensureSession(
  sessions: ReadonlyMap<ThreadId, HermesSessionContext>,
  threadId: ThreadId,
): HermesSessionContext {
  const context = sessions.get(threadId);
  if (!context) {
    throw new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId });
  }
  if (context.stopped || context.session.status === "closed") {
    throw new ProviderAdapterSessionClosedError({ provider: PROVIDER, threadId });
  }
  return context;
}

function latestResumeSessionId(context: HermesSessionContext): string | undefined {
  return sessionIdFromResumeCursor(context.session.resumeCursor);
}

async function collectProcessOutput(child: ChildProcessWithoutNullStreams): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ stdout, stderr, exitCode, signal }));
  });
}

function runHermesTurn(input: {
  readonly queue: Queue.Queue<ProviderRuntimeEvent>;
  readonly context: HermesSessionContext;
  readonly turnId: TurnId;
  readonly prompt: string;
  readonly sshHost?: string | undefined;
  readonly remoteCwd?: string | undefined;
  readonly command?: string | undefined;
  readonly model?: string | undefined;
}): void {
  const assistantItemId = RuntimeItemId.makeUnsafe(`hermes-assistant-${randomUUID()}`);
  const sshArgs = buildHermesSshArgs({
    prompt: input.prompt,
    sshHost: input.sshHost,
    remoteCwd: input.remoteCwd,
    command: input.command,
    model: input.model,
    resumeSessionId: latestResumeSessionId(input.context),
  });

  updateSession(input.context, { status: "running", activeTurnId: input.turnId });
  offerEvent(input.queue, input.context, {
    type: "session.state.changed",
    payload: { state: "running", reason: "hermes-remote-turn" },
    turnId: input.turnId,
  });
  offerEvent(input.queue, input.context, {
    type: "turn.started",
    payload: normalizeHermesModel(input.model) ? { model: input.model } : {},
    turnId: input.turnId,
  });
  offerEvent(input.queue, input.context, {
    type: "item.started",
    payload: {
      itemType: "assistant_message",
      status: "inProgress",
      title: "Hermes response",
    },
    turnId: input.turnId,
    itemId: assistantItemId,
  });

  const child = spawn("ssh", sshArgs, {
    env: process.env,
    stdio: "pipe",
  });
  input.context.activeProcess = child;

  void collectProcessOutput(child)
    .then(({ stdout, stderr, exitCode, signal }) => {
      input.context.activeProcess = undefined;
      const sessionId = extractHermesSessionId(stderr) ?? extractHermesSessionId(stdout);
      if (sessionId) {
        updateSession(input.context, {
          resumeCursor: { sessionId },
        });
      }

      if (exitCode === 0) {
        const text = stdout.trim();
        if (text.length > 0) {
          offerEvent(input.queue, input.context, {
            type: "content.delta",
            payload: {
              streamKind: "assistant_text",
              delta: text,
            },
            turnId: input.turnId,
            itemId: assistantItemId,
            raw: {
              source: "hermes.ssh.stdout",
              payload: { byteLength: Buffer.byteLength(stdout) },
            },
          });
        }
        input.context.turns.push({
          id: input.turnId,
          items: [
            {
              type: "assistant",
              text,
              provider: PROVIDER,
              ...(sessionId ? { sessionId } : {}),
            },
          ],
        });
        offerEvent(input.queue, input.context, {
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status: "completed",
            title: "Hermes response",
            ...(text.length > 0 ? { detail: text } : {}),
          },
          turnId: input.turnId,
          itemId: assistantItemId,
        });
        offerEvent(input.queue, input.context, {
          type: "turn.completed",
          payload: { state: "completed", stopReason: "completed" },
          turnId: input.turnId,
        });
        updateSession(input.context, { status: "ready", activeTurnId: undefined });
        offerEvent(input.queue, input.context, {
          type: "session.state.changed",
          payload: { state: "ready", reason: "hermes-remote-turn-completed" },
        });
        return;
      }

      const detail = truncateDetail(
        stderr || stdout || `Hermes SSH command exited with code ${exitCode ?? "unknown"}.`,
      );
      input.context.turns.push({
        id: input.turnId,
        items: [{ type: "error", detail, provider: PROVIDER, exitCode, signal }],
      });
      offerEvent(input.queue, input.context, {
        type: "runtime.error",
        payload: {
          message: detail,
          class: "provider_error",
          detail: { exitCode, signal },
        },
        turnId: input.turnId,
        raw: {
          source: "hermes.ssh.stderr",
          payload: { exitCode, signal },
        },
      });
      offerEvent(input.queue, input.context, {
        type: "turn.completed",
        payload: { state: "failed", errorMessage: detail },
        turnId: input.turnId,
      });
      updateSession(input.context, {
        status: "error",
        activeTurnId: undefined,
        lastError: detail,
      });
    })
    .catch((cause) => {
      input.context.activeProcess = undefined;
      const detail = cause instanceof Error ? cause.message : String(cause);
      offerEvent(input.queue, input.context, {
        type: "runtime.error",
        payload: {
          message: detail,
          class: "transport_error",
        },
        turnId: input.turnId,
      });
      offerEvent(input.queue, input.context, {
        type: "turn.completed",
        payload: { state: "failed", errorMessage: detail },
        turnId: input.turnId,
      });
      updateSession(input.context, {
        status: "error",
        activeTurnId: undefined,
        lastError: detail,
      });
    });
}

const make = Effect.gen(function* () {
  const sessions = new Map<ThreadId, HermesSessionContext>();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

  const adapter: HermesAdapterShape = {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "restart-session",
      supportsRuntimeModelList: false,
      supportsTurnSteering: false,
    },
    startSession: (input: ProviderSessionStartInput) =>
      Effect.sync(() => {
        const now = nowIso();
        const session: ProviderSession = {
          provider: PROVIDER,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          ...(input.modelSelection?.provider === PROVIDER
            ? { model: input.modelSelection.model }
            : {}),
          threadId: input.threadId,
          ...(input.resumeCursor ? { resumeCursor: input.resumeCursor } : {}),
          createdAt: now,
          updatedAt: now,
        };
        const context: HermesSessionContext = {
          session,
          turns: [],
          sshHost: input.providerOptions?.hermes?.sshHost,
          remoteCwd: input.providerOptions?.hermes?.remoteCwd,
          command: input.providerOptions?.hermes?.command,
          activeProcess: undefined,
          stopped: false,
        };
        sessions.set(input.threadId, context);
        offerEvent(runtimeEventQueue, context, {
          type: "session.started",
          payload: {
            message: "Hermes remote provider session ready.",
            ...(input.resumeCursor ? { resume: input.resumeCursor } : {}),
          },
        });
        offerEvent(runtimeEventQueue, context, {
          type: "session.state.changed",
          payload: { state: "ready", reason: "hermes-remote-session-ready" },
        });
        offerEvent(runtimeEventQueue, context, {
          type: "thread.started",
          payload: { providerThreadId: String(input.threadId) },
        });
        return session;
      }),
    sendTurn: (input: ProviderSendTurnInput) =>
      Effect.sync((): ProviderTurnStartResult => {
        const context = ensureSession(sessions, input.threadId);
        if (context.activeProcess) {
          throw new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail: "Hermes is already running a turn for this thread.",
          });
        }
        const prompt = trimToUndefined(input.input);
        if (!prompt) {
          throw new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Hermes requires a non-empty prompt.",
          });
        }
        if (input.attachments && input.attachments.length > 0) {
          throw new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Hermes remote provider does not support attachments in this first pass.",
          });
        }

        const turnId = TurnId.makeUnsafe(randomUUID());
        const model =
          input.modelSelection?.provider === PROVIDER ? input.modelSelection.model : undefined;
        runHermesTurn({
          queue: runtimeEventQueue,
          context,
          turnId,
          prompt,
          sshHost: context.sshHost,
          remoteCwd: context.remoteCwd,
          command: context.command,
          model,
        });
        return {
          threadId: input.threadId,
          turnId,
          ...(context.session.resumeCursor ? { resumeCursor: context.session.resumeCursor } : {}),
        };
      }),
    interruptTurn: (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        if (!context?.activeProcess) {
          return;
        }
        context.activeProcess.kill("SIGTERM");
        context.activeProcess = undefined;
        updateSession(context, { status: "ready", activeTurnId: undefined });
      }),
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession: (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        if (!context) {
          return;
        }
        context.stopped = true;
        context.activeProcess?.kill("SIGTERM");
        context.activeProcess = undefined;
        updateSession(context, { status: "closed", activeTurnId: undefined });
        offerEvent(runtimeEventQueue, context, {
          type: "session.exited",
          payload: { reason: "Hermes session stopped.", exitKind: "graceful" },
        });
      }),
    listSessions: () =>
      Effect.sync(() => Array.from(sessions.values()).map((entry) => entry.session)),
    hasSession: (threadId) => Effect.sync(() => sessions.has(threadId)),
    readThread: (threadId) =>
      Effect.sync(() => {
        const context = ensureSession(sessions, threadId);
        return {
          threadId,
          turns: context.turns,
          cwd: context.session.cwd ?? null,
        };
      }),
    rollbackThread: (threadId, numTurns) =>
      Effect.sync(() => {
        const context = ensureSession(sessions, threadId);
        if (numTurns > 0) {
          context.turns.splice(Math.max(0, context.turns.length - numTurns), numTurns);
        }
        return {
          threadId,
          turns: context.turns,
          cwd: context.session.cwd ?? null,
        };
      }),
    stopAll: () =>
      Effect.sync(() => {
        for (const context of sessions.values()) {
          context.stopped = true;
          context.activeProcess?.kill("SIGTERM");
          context.activeProcess = undefined;
          updateSession(context, { status: "closed", activeTurnId: undefined });
        }
        sessions.clear();
      }),
    streamEvents: Stream.fromQueue(runtimeEventQueue),
    getComposerCapabilities: () =>
      Effect.succeed({
        provider: PROVIDER,
        supportsSkillMentions: false,
        supportsSkillDiscovery: false,
        supportsNativeSlashCommandDiscovery: false,
        supportsPluginMentions: false,
        supportsPluginDiscovery: false,
        supportsRuntimeModelList: false,
        supportsThreadCompaction: false,
        supportsThreadImport: false,
      }),
  };

  return adapter;
});

export const HermesAdapterLive = Layer.effect(HermesAdapter, make);
