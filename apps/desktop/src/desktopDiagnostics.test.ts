import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

import { inspectCliStatus, inspectPathStatus } from "./desktopDiagnostics";

describe("desktopDiagnostics", () => {
  it("reports existing files with size metadata", () => {
    const tempDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "dpcode-diagnostics-"));
    try {
      const filePath = Path.join(tempDir, "state.sqlite");
      FS.writeFileSync(filePath, "sqlite");

      expect(inspectPathStatus("Chat database", filePath)).toEqual(
        expect.objectContaining({
          label: "Chat database",
          path: filePath,
          exists: true,
          kind: "file",
          sizeBytes: 6,
          error: null,
        }),
      );
    } finally {
      FS.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("resolves executable provider commands from PATH without running them", () => {
    const tempDir = FS.mkdtempSync(Path.join(OS.tmpdir(), "dpcode-diagnostics-cli-"));
    try {
      const commandPath = Path.join(tempDir, "codex");
      FS.writeFileSync(commandPath, "#!/bin/sh\nexit 0\n");
      FS.chmodSync(commandPath, 0o755);

      expect(
        inspectCliStatus("Codex", "codex", "linux", {
          PATH: tempDir,
        }),
      ).toEqual(
        expect.objectContaining({
          name: "Codex",
          command: "codex",
          path: commandPath,
          exists: true,
          executable: true,
        }),
      );
    } finally {
      FS.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
