import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { branchStatus, parseBranchStatus } from "./status.js";

const Platform = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)));

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();

const repository = Effect.acquireRelease(
  Effect.sync(() => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "wiki-branch-status-")));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "commit.gpgsign", "false");
    writeFileSync(join(dir, "app.ts"), "one\n");
    git(dir, "add", "app.ts");
    git(dir, "commit", "-qm", "init");
    return dir;
  }),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

describe("branchStatus", () => {
  it.effect("reads the upstream, ahead/behind and remote.pushDefault from a real repository", () =>
    Effect.gen(function* () {
      const dir = yield* repository;
      git(dir, "remote", "add", "origin", "https://example.com/origin.git");
      git(dir, "remote", "add", "fork", "https://example.com/fork.git");
      git(dir, "config", "remote.pushDefault", "fork");
      git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
      git(dir, "config", "branch.main.remote", "origin");
      git(dir, "config", "branch.main.merge", "refs/heads/main");
      writeFileSync(join(dir, "app.ts"), "two\n");
      git(dir, "commit", "-qam", "second");
      expect(yield* branchStatus(dir)).toEqual({
        branch: "main",
        head: git(dir, "rev-parse", "HEAD"),
        upstream: { remote: "origin", branch: "main" },
        ahead: 1,
        behind: 0,
        pushRemote: "fork",
        remotes: ["origin", "fork"],
      });
    }).pipe(Effect.provide(Platform)));
});

const cfg = (...pairs: ReadonlyArray<readonly [string, string]>) =>
  pairs.map(([key, value]) => `${key}\n${value}`).join("\0") + (pairs.length > 0 ? "\0" : "");

describe("parseBranchStatus", () => {
  it("parses normal branch with upstream and ahead/behind counts", () => {
    const status = [
      "# branch.oid 0123456789abcdef0123456789abcdef01234567",
      "# branch.head feat/perf.v2",
      "# branch.upstream origin/feat/perf.v2",
      "# branch.ab +3 -1",
      "1 .M N... 100644 100644 100644 abc def file.ts",
    ].join("\n");
    const config = cfg(
      ["remote.origin.url", "git@github.com:org/repo.git"],
      ["branch.feat/perf.v2.remote", "origin"],
      ["branch.feat/perf.v2.merge", "refs/heads/feat/perf.v2"],
    );
    expect(parseBranchStatus(status, config)).toEqual({
      branch: "feat/perf.v2",
      head: "0123456789abcdef0123456789abcdef01234567",
      upstream: { remote: "origin", branch: "feat/perf.v2" },
      ahead: 3,
      behind: 1,
      pushRemote: "origin",
      remotes: ["origin"],
    });
  });

  it("handles unborn branch before first commit", () => {
    const status = ["# branch.oid (initial)", "# branch.head main"].join("\n");
    expect(parseBranchStatus(status, "")).toEqual({
      branch: "main",
      head: null,
      upstream: null,
      ahead: null,
      behind: null,
      pushRemote: null,
      remotes: [],
    });
  });

  it("handles detached HEAD", () => {
    const status = ["# branch.oid deadbeef", "# branch.head (detached)"].join("\n");
    const config = cfg(["remote.upstream.url", "https://example.com/repo.git"]);
    expect(parseBranchStatus(status, config)).toEqual({
      branch: null,
      head: "deadbeef",
      upstream: null,
      ahead: null,
      behind: null,
      pushRemote: "upstream",
      remotes: ["upstream"],
    });
  });

  it("ignores local upstream (remote '.') and respects remote.pushDefault and dotted remote names", () => {
    const status = [
      "# branch.oid abc123",
      "# branch.head topic",
      "# branch.upstream main",
      "# branch.ab +2 -0",
    ].join("\n");
    const config = cfg(
      ["remote.origin.url", "https://example.com/origin.git"],
      ["remote.my.fork.url", "https://example.com/fork.git"],
      ["remote.pushdefault", "my.fork"],
      ["branch.topic.remote", "."],
      ["branch.topic.merge", "refs/heads/main"],
    );
    expect(parseBranchStatus(status, config)).toEqual({
      branch: "topic",
      head: "abc123",
      upstream: null,
      ahead: null,
      behind: null,
      pushRemote: "my.fork",
      remotes: ["origin", "my.fork"],
    });
  });
});
