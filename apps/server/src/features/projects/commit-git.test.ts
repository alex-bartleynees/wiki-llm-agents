import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { commitPaths } from "./commit-git.js";

const Spawner = NodeChildProcessSpawner.layer.pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();

/** A repository whose pre-commit hook runs `hook`, with `app.ts` changed. */
const repositoryWithHook = (hook: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "wiki-commit-git-")));
  git(dir, "init", "-q", "-b", "main");
  for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.com"], ["commit.gpgsign", "false"], ["core.hooksPath", join(dir, ".git", "hooks")]]) {
    git(dir, "config", key!, value!);
  }
  writeFileSync(join(dir, "app.ts"), "one\n");
  git(dir, "add", "app.ts");
  git(dir, "commit", "-qm", "init");
  writeFileSync(join(dir, ".git", "hooks", "pre-commit"), `#!/bin/sh\n${hook}\n`);
  chmodSync(join(dir, ".git", "hooks", "pre-commit"), 0o755);
  writeFileSync(join(dir, "app.ts"), "two\n");
  return dir;
};

// Real processes and a real time limit: the live clock, not the TestClock.
describe("git commit through the spawner", () => {
  it.live("commits with the message from stdin and gives the hook's output", () =>
    Effect.gen(function* () {
      const dir = repositoryWithHook("echo 'checked ok'");
      const output = yield* commitPaths(dir, ["app.ts"], "Change app\n\nBody.");
      expect(output).toBe("checked ok");
      expect(git(dir, "log", "-1", "--format=%B")).toBe("Change app\n\nBody.");
      rmSync(dir, { recursive: true, force: true });
    }).pipe(Effect.provide(Spawner)));

  it.live("stops a hook that hangs at the time limit, with what it printed, and commits nothing", () =>
    Effect.gen(function* () {
      const dir = repositoryWithHook("echo 'running the slow checks'\nexec sleep 60");
      const head = git(dir, "rev-parse", "HEAD");
      const started = Date.now();
      const error = yield* Effect.flip(commitPaths(dir, ["app.ts"], "Change app", Duration.millis(500)));
      expect(error._tag).toBe("GitRefused");
      expect(error.message).toMatch(/^git commit took longer than 500ms? and was stopped\.\nrunning the slow checks$/);
      // The hook's process group was ended, not waited for.
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(git(dir, "rev-parse", "HEAD")).toBe(head);
      rmSync(dir, { recursive: true, force: true });
    }).pipe(Effect.provide(Spawner)));
});
