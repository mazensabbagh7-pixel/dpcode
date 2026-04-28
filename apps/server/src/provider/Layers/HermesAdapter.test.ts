import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  buildHermesRemoteShellCommand,
  buildHermesSshArgs,
  extractHermesSessionId,
  shellQuote,
  shellQuoteRemotePath,
} from "./HermesAdapter";

describe("HermesAdapter helpers", () => {
  it("quotes shell arguments for the remote Hermes command", () => {
    assert.equal(shellQuote("akhi's laptop"), "'akhi'\\''s laptop'");
  });

  it("allows remote home expansion without opening shell injection", () => {
    assert.equal(
      shellQuoteRemotePath("~/.hermes-staging/hermes-agent"),
      "$HOME/'.hermes-staging/hermes-agent'",
    );
    assert.equal(
      shellQuoteRemotePath("$HOME/Hermes Projects/current"),
      "$HOME/'Hermes Projects/current'",
    );
    assert.equal(shellQuoteRemotePath("/tmp/akhi's path"), "'/tmp/akhi'\\''s path'");
  });

  it("builds a Mac Mini SSH command that keeps Hermes execution remote", () => {
    const args = buildHermesSshArgs({
      prompt: "reply with OK",
      model: "hermes-default",
      resumeSessionId: "session-1",
    });

    assert.deepEqual(args.slice(0, 5), [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      "mac-mini",
    ]);
    assert.match(args[5]!, /cd \$HOME\/'\.hermes-staging\/hermes-agent'/);
    assert.match(args[5]!, /HERMES_HOME=\$HOME\/'\.hermes-staging'/);
    assert.match(args[5]!, /'\.\/venv\/bin\/hermes' 'chat' '--query' 'reply with OK'/);
    assert.match(args[5]!, /'--source' 'mazen-code'/);
    assert.match(args[5]!, /'--resume' 'session-1'/);
    assert.doesNotMatch(args[5]!, /--model/);
  });

  it("does not use Hermes Telegram, gateway, or service-management commands", () => {
    const command = buildHermesRemoteShellCommand({
      prompt: "reply with OK",
      model: "hermes-default",
    });

    assert.match(command, /'\.\/venv\/bin\/hermes' 'chat'/);
    assert.match(command, /HERMES_HOME=\$HOME\/'\.hermes-staging'/);
    assert.doesNotMatch(
      command,
      /\b(launchctl|openclaw|telegram|gateway|run_agent|start_telegram|restart_telegram)\b/i,
    );
    assert.doesNotMatch(command, /'\.\/venv\/bin\/hermes-agent'/);
  });

  it("passes custom Hermes models through to the remote CLI", () => {
    const command = buildHermesRemoteShellCommand({
      prompt: "hello",
      model: "anthropic/claude-sonnet-4.6",
    });

    assert.match(command, /'--model' 'anthropic\/claude-sonnet-4\.6'/);
  });

  it("extracts quiet-mode Hermes session ids from stderr", () => {
    assert.equal(extractHermesSessionId("\nsession_id: 20260427_abc123\n"), "20260427_abc123");
  });
});
