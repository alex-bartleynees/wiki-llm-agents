import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { branchIdentity, deleteVerifiedRef, inspectBranch, repositoryIdentity } from "./branch-cleanup-git.js";
import { snapshot } from "./files.js";
import { runGit } from "./run-git.js";

const Platform = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();

const repository = Effect.acquireRelease(
  Effect.sync(() => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "wiki-run-git-")));
    git(dir, "init", "-q", "-b", "main");
    for (const [key, value] of [["user.name", "Test"], ["user.email", "test@example.com"], ["commit.gpgsign", "false"], ["core.hooksPath", join(dir, ".git", "hooks")]]) {
      git(dir, "config", key!, value!);
    }
    writeFileSync(join(dir, "app.ts"), "one\n");
    git(dir, "add", "app.ts");
    git(dir, "commit", "-qm", "init");
    git(dir, "branch", "merged");
    return dir;
  }),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

const deletion = Effect.fnUntraced(function* (dir: string) {
  const common = (yield* repositoryIdentity(dir))!;
  const ref = "refs/heads/merged";
  const tip = git(dir, "rev-parse", ref);
  const identity = (yield* branchIdentity(common, ref, tip))!;
  return { common, ref, remove: deleteVerifiedRef(dir, common, ref, tip, identity, "refs/heads/main", tip) };
});

const created = (directory: string, name: string) =>
  Effect.gen(function* () {
    const seen = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() => watch(directory, (_, changed) => {
        if (changed === name) Effect.runSync(Deferred.succeed(seen, undefined));
      })),
      (watcher) => Effect.sync(() => watcher.close()),
    );
    return Deferred.await(seen);
  });

describe("git reads through the spawner", () => {
  it.effect("gives exit codes, separate output and undamaged text, and null when git can't run", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      const text = "﻿café " + "ō".repeat(200_000);
      writeFileSync(join(dir, "large.txt"), text);
      git(dir, "add", "large.txt");
      expect(yield* runGit(dir, ["cat-file", "blob", ":large.txt"])).toEqual({ code: 0, stdout: text, stderr: "" });
      const missing = yield* runGit(dir, ["rev-parse", "--verify", "missing"]);
      expect(missing.code).toBe(128);
      expect(missing.stderr).toContain("Needed a single revision");
      expect((yield* runGit(dir, ["rev-parse", "a\0b"])).code).toBeNull();
    }).pipe(Effect.provide(Platform)));

  it.effect("completes inside an uninterruptible region", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      expect((yield* Effect.uninterruptible(runGit(dir, ["rev-parse", "HEAD"]))).code).toBe(0);
    }).pipe(Effect.provide(Platform)));

  it.effect("keeps hashes recorded with fractional modification times", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      const old = new Date("2020-01-01T00:00:00Z");
      const path = join(dir, "app.ts");
      utimesSync(path, old, old);
      const [file] = yield* snapshot([dir]);
      expect(file?.modifiedAt).toBe(old.getTime());
      const recorded = { ...file!, hash: "recorded", modifiedAt: old.getTime() + 0.456 };
      expect((yield* snapshot([dir], [recorded]))[0]?.hash).toBe("recorded");
    }).pipe(Effect.provide(Platform)));
});

describe("verified branch deletion", () => {
  it.effect("deletes the verified ref", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      const { common, ref, remove } = yield* deletion(dir);
      expect(yield* Effect.uninterruptible(remove)).toBe(true);
      expect(yield* inspectBranch(dir, ref, common)).toEqual({ status: "missing" });
    }).pipe(Effect.provide(Platform)));

  it.effect("aborts and leaves no lock when the branch's identity changed", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      const { common, ref, remove } = yield* deletion(dir);
      appendFileSync(join(common, "logs", ref), "\n");
      expect(yield* Effect.uninterruptible(remove)).toBe(false);
      expect((yield* inspectBranch(dir, ref, common)).status).toBe("present");
      expect(existsSync(join(common, ref + ".lock"))).toBe(false);
    }).pipe(Effect.provide(Platform)));

  it.effect("stops a transaction that hangs at the time limit, even uninterruptibly, and ends its hook", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      const { common, ref, remove } = yield* deletion(dir);
      const started = join(dir, "started");
      const hook = join(dir, ".git", "hooks", "reference-transaction");
      writeFileSync(hook, `#!/bin/sh\n[ "$1" = prepared ] || exit 0\necho $$ > '${started}.tmp'\nmv '${started}.tmp' '${started}'\nexec sleep 60\n`);
      chmodSync(hook, 0o755);
      const hookStarted = yield* created(dir, "started");
      const removing = yield* Effect.forkChild(Effect.uninterruptible(remove));
      yield* hookStarted;
      yield* TestClock.adjust("15 seconds");
      expect(yield* Fiber.join(removing)).toBe(false);
      expect(() => process.kill(Number(readFileSync(started, "utf8")), 0)).toThrow();
      expect((yield* inspectBranch(dir, ref, common)).status).toBe("present");
      expect(existsSync(join(common, ref + ".lock"))).toBe(false);
    }).pipe(Effect.provide(Platform)));
});
