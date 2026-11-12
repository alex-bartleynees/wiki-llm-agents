import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { afterAll } from "vitest";
import { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import { GetFileDiffResponse } from "@wiki-agents/contracts/projects/get-file-diff/response";
import { IgnoreFileResponse } from "@wiki-agents/contracts/projects/ignore-file/response";
import type { DiffFile } from "@wiki-agents/contracts/projects/model";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { UnignoreFileResponse } from "@wiki-agents/contracts/projects/unignore-file/response";
import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { FILE_LIMITS, LIST_LIMITS } from "../../src/features/projects/git-diff.js";
import { NOT_IN_A_PROJECT } from "../../src/features/mcp/tools/project-ignored-files/tool.js";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, post } from "./infrastructure/threads.js";

const sharedRoot = realpathSync(mkdtempSync(join(tmpdir(), "wiki-diff-vault-")));
writeFileSync(join(sharedRoot, "index.md"), "# Shared");
afterAll(() => rmSync(sharedRoot, { recursive: true, force: true }));

/** A canonical temp folder, removed afterwards. */
const temp = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-diff-")))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

/** git with a fixed identity and none of the user's config. */
const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    stdio: "ignore",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

const write = (dir: string, files: Readonly<Record<string, string | Uint8Array>>) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
};

/** A repository in `dir` with `files` committed. */
const repository = (dir: string, files: Readonly<Record<string, string | Uint8Array>>) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", "init");
  return dir;
};

const register = (workingDirectories: ReadonlyArray<string>) =>
  post("/api/projects", { name: "Diff", workingDirectories }).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));
const getDiff = (projectId: string) => HttpClient.get(`/api/projects/${projectId}/diff`).pipe(Effect.flatMap(decode(GetDiffResponse)));
const fileDiffUrl = (projectId: string, directory: string, path: string) =>
  `/api/projects/${projectId}/diff/file?${new URLSearchParams({ directory, path }).toString()}`;
const getFileDiff = (projectId: string, directory: string, path: string) =>
  HttpClient.get(fileDiffUrl(projectId, directory, path)).pipe(Effect.flatMap(decode(GetFileDiffResponse)), Effect.map((result) => result.file));
const byPath = (files: ReadonlyArray<DiffFile>) => Object.fromEntries(files.map((file) => [file.path, file]));

const TEN_LINES = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";

layer(makeTestApp({ vaults: [sharedRoot] }))("project diff", (test) => {
  test.effect("reads modified, staged, untracked, deleted, renamed and binary files from git", () => Effect.gen(function* () {
    const repo = repository(join(yield* temp, "repo"), {
      "src/app.ts": "const a = 1;\nconst b = 2;\n",
      "old-name.ts": TEN_LINES,
      "gone.txt": "bye\n",
      "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]),
      ".gitignore": "*.log\n",
    });
    const project = yield* register([repo]);
    expect((yield* getDiff(project.id)).directories).toEqual([{ directory: repo, git: true, files: [], changes: [], ignored: [] }]);

    write(repo, { "src/app.ts": "const a = 1;\nconst b = 3;\n", "staged.ts": "staged\n", "new.ts": "one\ntwo", "debug.log": "ignored\n" });
    write(repo, { "logo.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 9, 9]) });
    git(repo, "add", "staged.ts");
    unlinkSync(join(repo, "gone.txt"));
    git(repo, "mv", "old-name.ts", "new-name.ts");
    write(repo, { "new-name.ts": TEN_LINES.replace("line 5", "line five") });

    const [directory] = (yield* getDiff(project.id)).directories;
    expect(directory?.git).toBe(true);
    const files = byPath(directory!.files);
    expect(directory!.files.map((file) => file.path)).toEqual(["gone.txt", "logo.png", "new-name.ts", "new.ts", "src/app.ts", "staged.ts"]);
    expect(files["src/app.ts"]).toEqual({
      path: "src/app.ts", oldPath: null, status: "modified", binary: false, additions: 1, deletions: 1, truncated: false,
      diff: "@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;",
    });
    expect(files["staged.ts"]).toMatchObject({ status: "added", additions: 1, deletions: 0, diff: "@@ -0,0 +1 @@\n+staged" });
    expect(files["new.ts"]).toMatchObject({ status: "untracked", additions: 2, diff: "@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file" });
    expect(files["gone.txt"]).toMatchObject({ status: "deleted", additions: 0, deletions: 1, diff: "@@ -1 +0,0 @@\n-bye" });
    expect(files["new-name.ts"]).toMatchObject({ status: "renamed", oldPath: "old-name.ts", additions: 1, deletions: 1 });
    expect(files["new-name.ts"]?.diff).toContain("-line 5\n+line five");
    expect(files["logo.png"]).toMatchObject({ status: "modified", binary: true, additions: 0, deletions: 0, diff: "" });
    expect(files["debug.log"]).toBeUndefined();
  }));

  test.effect("compares with the empty tree before the first commit, and changes nothing in the repository", () => Effect.gen(function* () {
    const repo = join(yield* temp, "fresh");
    mkdirSync(repo);
    git(repo, "init", "-q");
    write(repo, { "a.txt": "a\n", "b.txt": "b\n" });
    git(repo, "add", "a.txt");
    const status = () => execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    const before = status();
    const project = yield* register([repo]);
    const [directory] = (yield* getDiff(project.id)).directories;
    expect(directory!.files.map((file) => [file.path, file.status])).toEqual([["a.txt", "added"], ["b.txt", "untracked"]]);
    expect(status()).toBe(before);
  }));

  test.effect("gives a nested working directory's paths relative to it, and leaves the rest of the repository out", () => Effect.gen(function* () {
    const repo = repository(join(yield* temp, "mono"), { "apps/web/page.ts": "page\n", "root.ts": "root\n" });
    write(repo, { "apps/web/page.ts": "page 2\n", "apps/web/fresh.ts": "fresh\n", "root.ts": "root 2\n", "outside.ts": "new\n" });
    const web = join(repo, "apps", "web");
    const project = yield* register([web, repo]);
    const [nested, top] = (yield* getDiff(project.id)).directories;
    expect(nested!.files.map((file) => [file.path, file.status])).toEqual([["fresh.ts", "untracked"], ["page.ts", "modified"]]);
    expect(top!.files.map((file) => file.path)).toEqual(["apps/web/fresh.ts", "apps/web/page.ts", "outside.ts", "root.ts"]);
    expect((yield* getFileDiff(project.id, web, "page.ts")).diff).toBe("@@ -1 +1 @@\n-page\n+page 2");
  }));

  test.effect("lists a folder outside git with its changed files and no diff", () => Effect.gen(function* () {
    const dir = yield* temp;
    const repo = repository(join(dir, "repo"), { "a.ts": "a\n" });
    const plain = join(dir, "plain");
    mkdirSync(plain);
    writeFileSync(join(plain, "notes.txt"), "old");
    const project = yield* register([repo, plain]);
    writeFileSync(join(plain, "notes.txt"), "new");
    writeFileSync(join(plain, "added.txt"), "added");
    const [, outside] = (yield* getDiff(project.id)).directories;
    expect(outside).toEqual({
      directory: plain,
      git: false,
      files: [],
      changes: [
        { directory: plain, path: "added.txt", status: "created" },
        { directory: plain, path: "notes.txt", status: "modified" },
      ],
      ignored: [],
    });
    expect((yield* HttpClient.get(fileDiffUrl(project.id, plain, "notes.txt"))).status).toBe(400);
  }));

  test.effect("cuts large diffs, and gives one file whole on request until that is too large too", () => Effect.gen(function* () {
    const repo = repository(join(yield* temp, "big"), {});
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `row ${index}`).join("\n") + "\n";
    write(repo, { "big.txt": lines(LIST_LIMITS.lines + 10), "huge.txt": lines(FILE_LIMITS.lines + 10) });
    const project = yield* register([repo]);
    const files = byPath((yield* getDiff(project.id)).directories[0]!.files);
    expect(files["big.txt"]).toMatchObject({ truncated: true, additions: LIST_LIMITS.lines + 10 });
    expect(files["big.txt"]!.diff.split("\n")).toHaveLength(LIST_LIMITS.lines);

    const whole = yield* getFileDiff(project.id, repo, "big.txt");
    expect(whole).toMatchObject({ truncated: false, additions: LIST_LIMITS.lines + 10 });
    expect((yield* getFileDiff(project.id, repo, "huge.txt")).truncated).toBe(true);
  }));

  test.effect("refuses paths outside the working directories, and files without changes", () => Effect.gen(function* () {
    const dir = yield* temp;
    const repo = repository(join(dir, "repo"), { "a.ts": "a\n", "sub/b.ts": "b\n" });
    const elsewhere = repository(join(dir, "elsewhere"), { "secret.txt": "s\n" });
    writeFileSync(join(elsewhere, "secret.txt"), "changed\n");
    write(repo, { "a.ts": "a2\n" });
    const project = yield* register([join(repo, "sub")]);
    const status = (directory: string, path: string) => HttpClient.get(fileDiffUrl(project.id, directory, path)).pipe(Effect.map((response) => response.status));
    const sub = join(repo, "sub");
    for (const [directory, path] of [
      [elsewhere, "secret.txt"],
      [repo, "a.ts"],
      [sub, "../a.ts"],
      [sub, "../../elsewhere/secret.txt"],
      [sub, "/etc/passwd"],
      [sub, "./b.ts"],
      [sub, ""],
    ] as const) expect([directory, path, yield* status(directory, path)]).toEqual([directory, path, 400]);
    expect(yield* status(sub, "b.ts")).toBe(404);
    expect(yield* status(sub, "*.ts")).toBe(404);
    expect((yield* HttpClient.get(fileDiffUrl("missing", sub, "b.ts"))).status).toBe(404);
    expect((yield* HttpClient.get(`/api/projects/missing/diff`)).status).toBe(404);
  }));

  test.effect("reports a working directory that has gone", () => Effect.gen(function* () {
    const dir = yield* temp;
    const plain = join(dir, "plain");
    mkdirSync(plain);
    const project = yield* register([plain]);
    renameSync(plain, join(dir, "moved"));
    expect((yield* HttpClient.get(`/api/projects/${project.id}/diff`)).status).toBe(409);
  }));

  test.effect("shows mode-only changes without a diff", () => Effect.gen(function* () {
    const repo = repository(join(yield* temp, "modes"), { "run.sh": "echo hi\n" });
    chmodSync(join(repo, "run.sh"), 0o755);
    const project = yield* register([repo]);
    expect((yield* getDiff(project.id)).directories[0]!.files).toEqual([
      { path: "run.sh", oldPath: null, status: "modified", binary: false, additions: 0, deletions: 0, diff: "", truncated: false },
    ]);
  }));

  test.effect("ignores files in the review until they are brought back, kept across reads", () => Effect.gen(function* () {
    const dir = yield* temp;
    const repo = repository(join(dir, "repo"), { "app.ts": "a\n", "local.config": "x\n" });
    const other = repository(join(dir, "other"), { "local.config": "x\n" });
    write(repo, { "app.ts": "a2\n", "local.config": "mine\n" });
    write(other, { "local.config": "mine\n" });
    const project = yield* register([repo, other]);
    const ignoredPath = `/api/projects/${project.id}/diff/ignored`;
    const unignore = (directory: string, path: string) => HttpClient.del(`${ignoredPath}?${new URLSearchParams({ directory, path }).toString()}`);

    const ignored = yield* post(ignoredPath, { directory: repo, path: "local.config" }).pipe(Effect.flatMap(decode(IgnoreFileResponse)));
    expect(ignored.ignored).toEqual([{ directory: repo, path: "local.config" }]);
    // Again changes nothing; a file without changes can be ignored too.
    yield* post(ignoredPath, { directory: repo, path: "local.config" }).pipe(Effect.flatMap(decode(IgnoreFileResponse)));
    const both = yield* post(ignoredPath, { directory: repo, path: "later.ts" }).pipe(Effect.flatMap(decode(IgnoreFileResponse)));
    expect(both.ignored).toEqual([{ directory: repo, path: "local.config" }, { directory: repo, path: "later.ts" }]);

    // The diff still has the file; each directory lists its own ignored paths.
    const [inRepo, inOther] = (yield* getDiff(project.id)).directories;
    expect(inRepo!.ignored).toEqual(["local.config", "later.ts"]);
    expect(inRepo!.files.map((file) => file.path)).toEqual(["app.ts", "local.config"]);
    expect(inOther!.ignored).toEqual([]);

    const after = yield* unignore(repo, "local.config").pipe(Effect.flatMap(decode(UnignoreFileResponse)));
    expect(after.ignored).toEqual([{ directory: repo, path: "later.ts" }]);
    expect((yield* unignore(repo, "never-ignored.ts").pipe(Effect.flatMap(decode(UnignoreFileResponse)))).ignored).toEqual([{ directory: repo, path: "later.ts" }]);
    expect((yield* getDiff(project.id)).directories[0]!.ignored).toEqual(["later.ts"]);
  }));

  test.effect("refuses to ignore paths outside the project's working directories", () => Effect.gen(function* () {
    const dir = yield* temp;
    const repo = repository(join(dir, "repo"), { "a.ts": "a\n" });
    const project = yield* register([repo]);
    const ignoredPath = `/api/projects/${project.id}/diff/ignored`;
    for (const [directory, path] of [
      [dir, "a.ts"],
      [repo, "../a.ts"],
      [repo, "/etc/passwd"],
      [repo, "./a.ts"],
      [repo, ""],
    ] as const) {
      expect([directory, path, (yield* post(ignoredPath, { directory, path })).status]).toEqual([directory, path, 400]);
      const query = new URLSearchParams({ directory, path }).toString();
      expect([directory, path, (yield* HttpClient.del(`${ignoredPath}?${query}`)).status]).toEqual([directory, path, 400]);
    }
    expect((yield* post(ignoredPath, { path: "a.ts" })).status).toBe(400);
    expect((yield* post("/api/projects/missing/diff/ignored", { directory: repo, path: "a.ts" })).status).toBe(404);
    expect((yield* getDiff(project.id)).directories[0]!.ignored).toEqual([]);
  }));

  test.effect("tells a project's agent which files are ignored, read when it asks", () => Effect.gen(function* () {
    const repo = repository(join(yield* temp, "repo"), { "a.ts": "a\n" });
    const project = yield* register([repo]);
    const newThread = (body: unknown) =>
      post(`/api/vaults/${project.vaultId}/threads`, body).pipe(Effect.flatMap(decode(CreateThreadResponse)), Effect.map((result) => result.thread));
    const thread = yield* newThread({ projectId: project.id });
    const mcp = yield* mcpSession((yield* tokenFor(thread.id, project.vaultId)).token);
    type Ignored = { project: string | null; files: ReadonlyArray<{ directory: string; path: string }>; notices: ReadonlyArray<string> };

    expect(yield* mcp.result<Ignored>("project_ignored_files")).toEqual({ project: "Diff", files: [], notices: ["The user ignores no files in this project."] });
    // Ignored after the thread started: the tool reads the current list.
    yield* post(`/api/projects/${project.id}/diff/ignored`, { directory: repo, path: "local.config" });
    expect(yield* mcp.result<Ignored>("project_ignored_files")).toEqual({ project: "Diff", files: [{ directory: repo, path: "local.config" }], notices: [] });

    // A vault thread has no project.
    const vaultThread = yield* newThread({});
    const vaultMcp = yield* mcpSession((yield* tokenFor(vaultThread.id, project.vaultId)).token);
    expect(yield* vaultMcp.result<Ignored>("project_ignored_files")).toEqual({ project: null, files: [], notices: [NOT_IN_A_PROJECT] });
  }));
});
