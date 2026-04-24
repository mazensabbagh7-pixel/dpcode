import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CheckpointRef } from "@t3tools/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { CheckpointStoreLive } from "./CheckpointStore.ts";
import { CheckpointStore } from "../Services/CheckpointStore.ts";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const GitCoreTestLayer = GitCoreLive.pipe(
  Layer.provide(ServerConfigLayer),
  Layer.provide(NodeServices.layer),
);
const TestLayer = CheckpointStoreLive.pipe(
  Layer.provide(GitCoreTestLayer),
  Layer.provide(NodeServices.layer),
);

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function gitRefExists(cwd: string, ref: string): boolean {
  try {
    runGit(cwd, ["show-ref", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

describe("CheckpointStoreLive", () => {
  let runtime: ManagedRuntime.ManagedRuntime<CheckpointStore, unknown> | null = null;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("skips checkpoint capture for an unborn repository without creating a ref", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "t3-checkpoint-unborn-"));
    tempDirs.push(cwd);
    runGit(cwd, ["init", "--initial-branch=main"]);
    fs.writeFileSync(path.join(cwd, "README.md"), "draft\n", "utf8");

    runtime = ManagedRuntime.make(TestLayer);
    const checkpointStore = await runtime.runPromise(Effect.service(CheckpointStore));
    const checkpointRef = CheckpointRef.makeUnsafe("refs/t3/checkpoints/test/unborn");

    await runtime.runPromise(
      checkpointStore.captureCheckpoint({
        cwd,
        checkpointRef,
      }),
    );

    expect(gitRefExists(cwd, checkpointRef)).toBe(false);
  });
});
