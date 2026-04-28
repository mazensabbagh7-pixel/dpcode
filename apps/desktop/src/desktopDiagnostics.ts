import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import type {
  DesktopDiagnosticBackendHealth,
  DesktopDiagnosticCliStatus,
  DesktopDiagnosticPathStatus,
  DesktopDiagnosticsReport,
  DesktopUpdateState,
} from "@t3tools/contracts";

const DIAGNOSTIC_CLI_COMMANDS = [
  ["Codex", "codex"],
  ["Claude", "claude"],
  ["Gemini", "gemini"],
  ["OpenCode", "opencode"],
  ["Hermes", "ssh"],
] as const;

export interface DesktopDiagnosticsInput {
  readonly appName: string;
  readonly appVersion: string;
  readonly commitHash: string | null;
  readonly isPackaged: boolean;
  readonly runId: string;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly logDir: string;
  readonly appRoot: string;
  readonly resourcesPath: string;
  readonly electronUserDataPath: string;
  readonly staticDir: string | null;
  readonly backendPid: number | null;
  readonly backendPort: number;
  readonly backendHttpUrl: string;
  readonly backendWsUrl: string;
  readonly updateState: DesktopUpdateState;
  readonly env: NodeJS.ProcessEnv;
}

function toIsoTime(valueMs: number): string | null {
  if (!Number.isFinite(valueMs) || valueMs <= 0) return null;
  return new Date(valueMs).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inspectPathStatus(label: string, targetPath: string): DesktopDiagnosticPathStatus {
  try {
    const stats = FS.statSync(targetPath);
    return {
      label,
      path: targetPath,
      exists: true,
      kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
      sizeBytes: stats.isFile() ? stats.size : null,
      modifiedAt: toIsoTime(stats.mtimeMs),
      error: null,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    return {
      label,
      path: targetPath,
      exists: false,
      kind: "missing",
      sizeBytes: null,
      modifiedAt: null,
      error: nodeError.code === "ENOENT" ? null : errorMessage(error),
    };
  }
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function executableExtensions(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  if (platform !== "win32") return [""];
  const pathext = env.PATHEXT || ".EXE;.CMD;.BAT;.COM";
  return pathext
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function candidateCommands(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const extensions = executableExtensions(platform, env);
  const lowerCommand = command.toLowerCase();
  const alreadyHasWindowsExtension =
    platform === "win32" && extensions.some((extension) => lowerCommand.endsWith(extension));
  if (platform !== "win32" || alreadyHasWindowsExtension) return [command];
  return extensions.map((extension) => `${command}${extension}`);
}

function isExecutable(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    if (platform === "win32") {
      return FS.statSync(filePath).isFile();
    }
    FS.accessSync(filePath, FS.constants.X_OK);
    return FS.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveCommandPath(
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | null {
  const directCandidates = candidateCommands(command, platform, env);
  if (hasPathSeparator(command)) {
    return directCandidates.find((candidate) => isExecutable(candidate, platform)) ?? null;
  }

  const pathEntries = (env.PATH ?? "")
    .split(Path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const candidate of directCandidates) {
      const resolved = Path.join(entry, candidate);
      if (isExecutable(resolved, platform)) return resolved;
    }
  }

  return null;
}

export function inspectCliStatus(
  name: string,
  command: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): DesktopDiagnosticCliStatus {
  const resolvedPath = resolveCommandPath(command, platform, env);
  if (!resolvedPath) {
    return {
      name,
      command,
      path: null,
      exists: false,
      executable: false,
      sizeBytes: null,
      error: null,
    };
  }

  try {
    const stats = FS.statSync(resolvedPath);
    return {
      name,
      command,
      path: resolvedPath,
      exists: true,
      executable: isExecutable(resolvedPath, platform),
      sizeBytes: stats.isFile() ? stats.size : null,
      error: null,
    };
  } catch (error) {
    return {
      name,
      command,
      path: resolvedPath,
      exists: false,
      executable: false,
      sizeBytes: null,
      error: errorMessage(error),
    };
  }
}

function redactedWsUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.searchParams.has("token")) {
      url.searchParams.set("token", "[redacted]");
    }
    return url.toString();
  } catch {
    return "[redacted]";
  }
}

function readBooleanHealthField(payload: unknown, key: string): boolean | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

async function readBackendHealth(baseUrl: string): Promise<DesktopDiagnosticBackendHealth> {
  const checkedAt = new Date().toISOString();
  if (!baseUrl) {
    return {
      checkedAt,
      ok: false,
      status: null,
      statusText: null,
      startupReady: null,
      pushBusReady: null,
      keybindingsReady: null,
      terminalSubscriptionsReady: null,
      orchestrationSubscriptionsReady: null,
      error: "Backend URL is not available.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  timeout.unref();

  try {
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      checkedAt,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      startupReady: readBooleanHealthField(payload, "startupReady"),
      pushBusReady: readBooleanHealthField(payload, "pushBusReady"),
      keybindingsReady: readBooleanHealthField(payload, "keybindingsReady"),
      terminalSubscriptionsReady: readBooleanHealthField(payload, "terminalSubscriptionsReady"),
      orchestrationSubscriptionsReady: readBooleanHealthField(
        payload,
        "orchestrationSubscriptionsReady",
      ),
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      checkedAt,
      ok: false,
      status: null,
      statusText: null,
      startupReady: null,
      pushBusReady: null,
      keybindingsReady: null,
      terminalSubscriptionsReady: null,
      orchestrationSubscriptionsReady: null,
      error: errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildDesktopDiagnosticsReport(
  input: DesktopDiagnosticsInput,
): Promise<DesktopDiagnosticsReport> {
  const defaultApplicationsDir = Path.join(OS.homedir(), "Applications");
  const paths = [
    inspectPathStatus("MazenCode home", input.baseDir),
    inspectPathStatus("Server state", input.stateDir),
    inspectPathStatus("Chat database", Path.join(input.stateDir, "state.sqlite")),
    inspectPathStatus("Log directory", input.logDir),
    inspectPathStatus("Desktop log", Path.join(input.logDir, "desktop-main.log")),
    inspectPathStatus("Server log", Path.join(input.logDir, "server-child.log")),
    inspectPathStatus("Electron profile", input.electronUserDataPath),
    inspectPathStatus("App root", input.appRoot),
    inspectPathStatus("Resources", input.resourcesPath),
    inspectPathStatus("Installed bundle", Path.join(input.resourcesPath, "app.asar")),
    inspectPathStatus("Static web bundle", input.staticDir ?? Path.join(input.appRoot, "missing")),
    inspectPathStatus("Default launcher", Path.join(defaultApplicationsDir, "dp-code-launch.sh")),
    inspectPathStatus(
      "Default update script",
      Path.join(defaultApplicationsDir, "dp-code-update.sh"),
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: input.appName,
      version: input.appVersion,
      commitHash: input.commitHash,
      isPackaged: input.isPackaged,
      runId: input.runId,
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron ?? "unknown",
      chrome: process.versions.chrome ?? "unknown",
      node: process.versions.node,
      pid: process.pid,
    },
    backend: {
      pid: input.backendPid,
      port: input.backendPort > 0 ? input.backendPort : null,
      httpUrl: input.backendHttpUrl || null,
      wsUrl: redactedWsUrl(input.backendWsUrl),
      health: await readBackendHealth(input.backendHttpUrl),
    },
    paths,
    providers: DIAGNOSTIC_CLI_COMMANDS.map(([name, command]) =>
      inspectCliStatus(name, command, process.platform, input.env),
    ),
    update: input.updateState,
    environment: {
      electronRunAsNode: input.env.ELECTRON_RUN_AS_NODE ?? null,
      appImagePresent: Boolean(input.env.APPIMAGE),
      xdgSessionType: input.env.XDG_SESSION_TYPE ?? null,
      waylandDisplayPresent: Boolean(input.env.WAYLAND_DISPLAY),
      displayPresent: Boolean(input.env.DISPLAY),
    },
  };
}
