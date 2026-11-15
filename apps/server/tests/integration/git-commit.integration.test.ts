import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { afterAll } from "vitest";
import { CommitChangesResponse } from "@wiki-agents/contracts/projects/commit-changes/response";
import { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import { GetGitStatusResponse } from "@wiki-agents/contracts/projects/get-git-status/response";
import type { DirectoryDiff } from "@wiki-agents/contracts/projects/model";
import { PushBranchResponse } from "@wiki-agents/contracts/projects/push-branch/response";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, post } from "./infrastructure/threads.js";

const sharedRoot = realpathSync(mkdtempSync(join(tmpdir(), "wiki-commit-vault-")));
writeFileSync(join(sharedRoot, "index.md"), "# Shared");
afterAll(() => rmSync(sharedRoot, { recursive: true, force: true }));

/** A canonical temp folder, removed afterwards. */
const temp = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-commit-")))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

/** git without the user's config (the app's own git calls read the repository's). */
const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trimEnd();

const write = (dir: string, files: Readonly<Record<string, string>>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
};

/**
 * A repository with `files` committed on `main`, its identity, signing and hooks set
 * in its own config, so the app's commits don't depend on the user's.
 */
const repository = (dir: string, files: Readonly<Record<string, string>>) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  for (const [key, value] of [
    ["user.name", "Test"],
    ["user.email", "test@example.com"],
    ["commit.gpgsign", "false"],
    ["core.hooksPath", join(dir, ".git", "hooks")],
  ]) {
    git(dir, "config", key!, value!);
  }
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
};

/** A bare repository `repo` pushes `main` to as `origin`, with the upstream set. */
const withRemote = (repo: string, remote: string) => {
  git(repo, "init", "-q", "--bare", "-b", "main", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  return remote;
};

const register = (workingDirectories: ReadonlyArray<string>) =>
  post("/api/projects", { name: "Commit", workingDirectories }).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));
const reviewOf = (projectId: string, directory: string) =>
  HttpClient.get(`/api/projects/${projectId}/diff`).pipe(
    Effect.flatMap(decode(GetDiffResponse)),
    Effect.map((result) => result.directories.find((entry) => entry.directory === directory)!),
  );
const statusOf = (projectId: string) => HttpClient.get(`/api/projects/${projectId}/git`).pipe(Effect.flatMap(decode(GetGitStatusResponse)));

/** The commit request for `paths` as `review` showed them (both sides of a rename). */
const ticked = (review: DirectoryDiff, paths: ReadonlyArray<string>, message = "Change things") => ({
  directory: review.directory,
  head: review.head ?? null,
  message,
  files: review.files
    .filter((file) => paths.includes(file.path))
    .flatMap((file) => [{ path: file.path, hash: file.hash ?? null }, ...(file.oldPath === null ? [] : [{ path: file.oldPath, hash: null }])]),
});
const commit = (projectId: string, body: unknown) => post(`/api/projects/${projectId}/git/commit`, body);
const commitOk = (projectId: string, body: unknown) => commit(projectId, body).pipe(Effect.flatMap(decode(CommitChangesResponse)));
const push = (projectId: string, body: unknown) => post(`/api/projects/${projectId}/git/push`, body);
const pushOk = (projectId: string, body: unknown) => push(projectId, body).pipe(Effect.flatMap(decode(PushBranchResponse)));

/** Paths in the last commit, with git's status letter. */
const lastCommit = (repo: string) => git(repo, "show", "--name-status", "--format=%s", "HEAD").split("\n").filter(Boolean);
const staged = (repo: string) => git(repo, "diff", "--cached", "--name-only").split("\n").filter(Boolean);

layer(makeTestApp({ vaults: [sharedRoot] }))("commit and push from the diff view", (test) => {
  test.effect("commits exactly the ticked files: new, modified, deleted and renamed; untouched and staged others stay out", () =>
    Effect.gen(function* () {
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n", "gone.ts": "bye\n", "old.ts": "moving\n", "local.env": "A=1\n" });
      const project = yield* register([repo]);
      write(repo, { "app.ts": "two\n", "new.ts": "fresh\n", "local.env": "A=2\n", "later.ts": "not yet\n" });
      rmSync(join(repo, "gone.ts"));
      git(repo, "mv", "old.ts", "renamed.ts");
      // An agent staged the env file; unticked, it must stay out of the commit.
      git(repo, "add", "local.env");

      const review = yield* reviewOf(project.id, repo);
      expect(review.head).toBe(git(repo, "rev-parse", "HEAD"));
      expect(review.files.find((file) => file.path === "gone.ts")!.hash).toBeNull();
      expect(review.files.find((file) => file.path === "app.ts")!.hash).toMatch(/^[0-9a-f]{64}$/);

      const result = yield* commitOk(project.id, ticked(review, ["app.ts", "new.ts", "gone.ts", "renamed.ts"], "  Change things\n\nWith a body.\n"));
      expect(result.commit).toMatchObject({ hash: git(repo, "rev-parse", "HEAD"), subject: "Change things" });
      expect(result.commit.shortHash.length).toBeGreaterThanOrEqual(7);
      expect(result.status).toMatchObject({ directory: repo, branch: "main", head: result.commit.hash, upstream: null, pushRemote: null });
      expect(lastCommit(repo)).toEqual(["Change things", "M\tapp.ts", "D\tgone.ts", "A\tnew.ts", "R100\told.ts\trenamed.ts"]);
      expect(git(repo, "log", "-1", "--format=%B")).toBe("Change things\n\nWith a body.");
      // What wasn't ticked is as it was: the env file still staged, later.ts untracked.
      expect(staged(repo)).toEqual(["local.env"]);
      expect(git(repo, "status", "--porcelain")).toBe("M  local.env\n?? later.ts");
      expect((yield* reviewOf(project.id, repo)).files.map((file) => file.path)).toEqual(["later.ts", "local.env"]);
    }));

  test.effect("commits an ignored file only when it is ticked", () =>
    Effect.gen(function* () {
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n", "local.env": "A=1\n" });
      const project = yield* register([repo]);
      yield* post(`/api/projects/${project.id}/diff/ignored`, { directory: repo, path: "local.env" });
      write(repo, { "app.ts": "two\n", "local.env": "A=2\n" });
      const review = yield* reviewOf(project.id, repo);
      expect(review.ignored).toEqual(["local.env"]);

      yield* commitOk(project.id, ticked(review, ["app.ts"]));
      expect(lastCommit(repo)).toEqual(["Change things", "M\tapp.ts"]);
      yield* commitOk(project.id, ticked(yield* reviewOf(project.id, repo), ["local.env"], "On purpose"));
      expect(lastCommit(repo)).toEqual(["On purpose", "M\tlocal.env"]);
    }));

  test.effect("refuses a stale review: a file or HEAD changed since, or a file no longer changed", () =>
    Effect.gen(function* () {
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n", "other.ts": "x\n" });
      const project = yield* register([repo]);
      write(repo, { "app.ts": "two\n", "other.ts": "y\n" });
      const review = yield* reviewOf(project.id, repo);
      const head = git(repo, "rev-parse", "HEAD");

      // An agent writes again after the review.
      write(repo, { "app.ts": "three\n" });
      const changed = yield* commit(project.id, ticked(review, ["app.ts"]));
      expect(changed.status).toBe(409);
      expect(yield* changed.text).toBe("Changed since you reviewed them: app.ts. Review the changes again.");

      // Made executable: git would commit the new mode, which you didn't review.
      chmodSync(join(repo, "other.ts"), 0o755);
      const mode = yield* commit(project.id, ticked(review, ["other.ts"]));
      expect(mode.status).toBe(409);
      expect(yield* mode.text).toBe("Changed since you reviewed them: other.ts. Review the changes again.");
      chmodSync(join(repo, "other.ts"), 0o644);

      write(repo, { "other.ts": "x\n" });
      const unchanged = yield* commit(project.id, ticked(review, ["other.ts"]));
      expect(unchanged.status).toBe(409);
      expect(yield* unchanged.text).toContain("No longer changed: other.ts");

      git(repo, "commit", "-q", "-am", "elsewhere");
      const moved = yield* commit(project.id, ticked(review, ["app.ts"]));
      expect(moved.status).toBe(409);
      expect(yield* moved.text).toContain("A commit was made here since you reviewed");
      expect(git(repo, "rev-list", "--count", `${head}..HEAD`)).toBe("1");
    }));

  test.effect("shows a failing hook's output, commits nothing and takes new files back out of the index", () =>
    Effect.gen(function* () {
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n" });
      const hook = join(repo, ".git", "hooks", "pre-commit");
      writeFileSync(hook, "#!/bin/sh\necho 'lint: app.ts has a TODO' >&2\nexit 1\n");
      chmodSync(hook, 0o755);
      const project = yield* register([repo]);
      write(repo, { "app.ts": "two\n", "new.ts": "fresh\n" });
      const head = git(repo, "rev-parse", "HEAD");

      const refused = yield* commit(project.id, ticked(yield* reviewOf(project.id, repo), ["app.ts", "new.ts"]));
      expect(refused.status).toBe(409);
      expect(yield* refused.text).toContain("lint: app.ts has a TODO");
      expect(git(repo, "rev-parse", "HEAD")).toBe(head);
      expect(staged(repo)).toEqual([]);
      expect(git(repo, "status", "--porcelain")).toBe(" M app.ts\n?? new.ts");
    }));

  test.effect("refuses bad requests: no message, no files, paths outside, other directories", () =>
    Effect.gen(function* () {
      const dir = yield* temp;
      const repo = repository(join(dir, "repo"), { "app.ts": "one\n" });
      const plain = join(dir, "plain");
      mkdirSync(plain);
      const project = yield* register([repo, plain]);
      write(repo, { "app.ts": "two\n" });
      const review = yield* reviewOf(project.id, repo);
      const body = ticked(review, ["app.ts"]);
      for (const [request, message] of [
        [{ ...body, message: "  \n" }, "Write a commit message"],
        [{ ...body, files: [] }, "Tick at least one file to commit"],
        [{ ...body, files: [{ path: "../x", hash: null }] }, "Paths must be relative and inside the working directory"],
        [{ ...body, directory: plain }, "Not one of the project's working directories in git, or a thread's worktree"],
        [{ ...body, directory: dir }, "Not one of the project's working directories in git, or a thread's worktree"],
      ] as const) {
        const response = yield* commit(project.id, request);
        expect(response.status).toBe(400);
        expect(yield* response.text).toBe(message);
      }
      expect(git(repo, "rev-list", "--count", "HEAD")).toBe("1");
      // Only git directories have a branch.
      expect((yield* statusOf(project.id)).directories.map((entry) => entry.directory)).toEqual([repo]);
    }));

  test.effect("pushes the branch to its upstream, and a branch without one only when asked", () =>
    Effect.gen(function* () {
      const dir = yield* temp;
      const repo = repository(join(dir, "repo"), { "app.ts": "one\n" });
      const remote = withRemote(repo, join(dir, "remote.git"));
      const project = yield* register([repo]);
      expect((yield* statusOf(project.id)).directories).toEqual([
        { directory: repo, branch: "main", head: git(repo, "rev-parse", "HEAD"), upstream: { remote: "origin", branch: "main" }, ahead: 0, behind: 0, pushRemote: "origin" },
      ]);

      write(repo, { "app.ts": "two\n" });
      const committed = yield* commitOk(project.id, ticked(yield* reviewOf(project.id, repo), ["app.ts"]));
      expect(committed.status).toMatchObject({ ahead: 1, behind: 0 });
      const pushed = yield* pushOk(project.id, { directory: repo, branch: "main" });
      expect(pushed.status).toMatchObject({ ahead: 0, behind: 0 });
      expect(git(remote, "rev-parse", "main")).toBe(committed.commit.hash);

      // Another branch checked out than the one you saw.
      git(repo, "switch", "-q", "-c", "feature");
      const otherBranch = yield* push(project.id, { directory: repo, branch: "main" });
      expect(otherBranch.status).toBe(409);
      expect(yield* otherBranch.text).toBe("feature is checked out now, not main. Refresh and try again.");

      // No upstream: asks first, then pushes to the same name and sets it.
      expect((yield* statusOf(project.id)).directories[0]).toMatchObject({ branch: "feature", upstream: null, ahead: null, behind: null, pushRemote: "origin" });
      const unasked = yield* push(project.id, { directory: repo, branch: "feature" });
      expect(unasked.status).toBe(409);
      expect(yield* unasked.text).toContain("feature has no upstream yet");
      const unknown = yield* push(project.id, { directory: repo, branch: "feature", setUpstream: { remote: "elsewhere" } });
      expect(unknown.status).toBe(400);
      const upstream = yield* pushOk(project.id, { directory: repo, branch: "feature", setUpstream: { remote: "origin" } });
      expect(upstream.status).toMatchObject({ branch: "feature", upstream: { remote: "origin", branch: "feature" }, ahead: 0, behind: 0 });
      expect(git(remote, "rev-parse", "feature")).toBe(git(repo, "rev-parse", "HEAD"));
    }));

  test.effect("shows git's message when the remote rejects the push, and never forces it", () =>
    Effect.gen(function* () {
      const dir = yield* temp;
      const repo = repository(join(dir, "repo"), { "app.ts": "one\n" });
      const remote = withRemote(repo, join(dir, "remote.git"));
      // Someone else pushes first.
      const other = join(dir, "other");
      git(dir, "clone", "-q", remote, other);
      write(other, { "theirs.ts": "theirs\n" });
      git(other, "add", "theirs.ts");
      git(other, "-c", "user.name=Other", "-c", "user.email=other@example.com", "commit", "-q", "-m", "theirs");
      git(other, "push", "-q");
      const theirs = git(other, "rev-parse", "HEAD");

      const project = yield* register([repo]);
      write(repo, { "app.ts": "two\n" });
      yield* commitOk(project.id, ticked(yield* reviewOf(project.id, repo), ["app.ts"]));
      const rejected = yield* push(project.id, { directory: repo, branch: "main" });
      expect(rejected.status).toBe(409);
      expect(yield* rejected.text).toMatch(/rejected/);
      expect(git(remote, "rev-parse", "main")).toBe(theirs);
    }));
});
