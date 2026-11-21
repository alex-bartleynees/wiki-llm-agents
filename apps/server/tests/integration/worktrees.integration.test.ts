import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, layer } from "@effect/vitest";
import { afterAll } from "vitest";
import { DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import { GetFileDiffResponse } from "@wiki-agents/contracts/projects/get-file-diff/response";
import { IgnoreFileResponse } from "@wiki-agents/contracts/projects/ignore-file/response";
import { ListWorktreesResponse } from "@wiki-agents/contracts/projects/list-worktrees/response";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { ContinueThreadResponse } from "@wiki-agents/contracts/threads/continue-thread/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import { RemoveWorktreeResponse } from "@wiki-agents/contracts/threads/remove-worktree/response";
import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { Effect, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import type { OpenSessionInput, ProviderAdapter, ProviderEvent } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { mcpSession } from "./infrastructure/mcp.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import { decode, getThread, interrupt, isTag, post, sendOk, watch } from "./infrastructure/threads.js";

/**
 * A provider that writes files where its session runs: "write <path> <text>" writes
 * `<text>` to `<path>` in the session's folder; "wait" opens an approval and waits.
 * Every session it opens is kept, with the folder and setup the app gave it.
 */
const opened: Array<OpenSessionInput> = [];
const writer: ProviderAdapter = {
  kind: "writer",
  capabilities: { interrupt: true, resume: false, approvals: true, questions: false, models: false, images: false },
  openSession: (input) =>
    Effect.sync(() => {
      opened.push(input);
      return {
        nativeSessionId: null,
        startTurn: ({ turnId, text }) => {
          if (text.startsWith("wait")) {
            return Stream.concat(
              Stream.succeed<ProviderEvent>({ _tag: "request.opened", turnId, requestId: `${turnId}-ask`, prompt: { _tag: "approval", title: "Run tests", detail: "npm test" } }),
              Stream.never,
            );
          }
          const [, path, ...words] = text.split("\n")[0]!.split(" ");
          if (path !== undefined) {
            mkdirSync(dirname(join(input.cwd, path)), { recursive: true });
            writeFileSync(join(input.cwd, path), `${words.join(" ")}\n`);
          }
          return Stream.succeed<ProviderEvent>({ _tag: "turn.finished", turnId, outcome: "completed", usage: null, reason: null });
        },
        resumeTurn: () => Effect.succeedNone,
        interrupt: () => Effect.void,
        answerRequest: () => Effect.void,
        setModel: () => Effect.void,
      };
    }),
  enforcement: () => ({ autonomy: null, notes: [] }),
  status: Effect.succeed({ _tag: "ready", version: null, account: null }),
  listModels: () => Effect.succeed({ models: [], defaultModel: null }),
};

/** The shared vault: registered at startup. */
const sharedRoot = realpathSync(mkdtempSync(join(tmpdir(), "wiki-worktrees-vault-")));
writeFileSync(join(sharedRoot, "index.md"), "# Shared");
mkdirSync(join(sharedRoot, "Projects"));
afterAll(() => rmSync(sharedRoot, { recursive: true, force: true }));
const shared = HttpClient.get("/api/vaults").pipe(
  Effect.flatMap(decode(ListVaultsResponse)),
  Effect.map(({ vaults }) => vaults.find((vault) => vault.rootPath === sharedRoot)!),
);

/** A canonical temp folder, removed afterwards. */
const temp = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-worktrees-")))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

/** git with a fixed identity and none of the user's config. */
const git = (cwd: string, ...args: Array<string>) =>
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  });

/** A repository in `dir` with `files` committed. */
const repository = (dir: string, files: Readonly<Record<string, string>>) => {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
};

const register = (body: unknown) => post("/api/projects", body).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));
const createThread = (vaultId: string, body: unknown) =>
  post(`/api/vaults/${vaultId}/threads`, body).pipe(Effect.flatMap(decode(CreateThreadResponse)), Effect.map((result) => result.thread));
const threadIds = (vaultId: string, projectId: string) =>
  HttpClient.get(`/api/vaults/${vaultId}/threads?projectId=${projectId}`).pipe(
    Effect.flatMap(decode(ListThreadsResponse)),
    Effect.map((result) => result.threads.map((thread) => thread.id)),
  );
const listing = (projectId: string) => HttpClient.get(`/api/projects/${projectId}/worktrees`).pipe(Effect.flatMap(decode(ListWorktreesResponse)));
const worktrees = (projectId: string) => listing(projectId).pipe(Effect.map((result) => result.worktrees));
const availability = (projectId: string) => listing(projectId).pipe(Effect.map(({ available, unavailableReason }) => ({ available, unavailableReason })));
const getDiff = (projectId: string) => HttpClient.get(`/api/projects/${projectId}/diff`).pipe(Effect.flatMap(decode(GetDiffResponse)), Effect.map((result) => result.directories));
const removeWorktree = (threadId: string) => post(`/api/threads/${threadId}/worktree/remove`, {});
const continueThread = (threadId: string, body: unknown) => post(`/api/threads/${threadId}/continue`, body);
const continueOk = (threadId: string, body: unknown) =>
  continueThread(threadId, body).pipe(Effect.flatMap(decode(ContinueThreadResponse)), Effect.map((result) => result.thread));

/** Sends `text` and waits for the turn to finish; returns the finishing event. */
const turn = (threadId: string, text: string) =>
  Effect.gen(function* () {
    const events = yield* watch(threadId);
    yield* sendOk(threadId, text);
    return (yield* events.until(isTag("turn.finished"), "1 minute")).at(-1)!;
  });
const sessionOf = (threadId: string) => opened.findLast((input) => input.threadId === threadId)!;
const branches = (repo: string) => git(repo, "branch", "--format=%(refname:short)").split("\n").filter(Boolean).sort();

layer(makeTestApp({ vaults: [sharedRoot], providers: makeProviderRegistry(Effect.succeed([writer])) }))("thread worktrees", (test) => {
  test.effect("runs a thread in its own worktree on a new branch, leaving the main directory untouched", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const dir = yield* temp;
      const repo = repository(join(dir, "repo"), { "app.ts": "one\n", "local.env": "A=1\n" });
      const extra = join(dir, "extra");
      mkdirSync(extra);
      const project = yield* register({ name: "App", workingDirectories: [repo, extra] });

      const first = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "wiki-agents/one" } });
      const second = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "wiki-agents/two" } });
      const [one, two] = yield* worktrees(project.id);
      expect(one).toMatchObject({ threadId: first.id, projectId: project.id, branch: "wiki-agents/one", removedAt: null, exists: true, changedFiles: 0 });
      expect(one!.path).toMatch(new RegExp(`/wiki-agents-worktrees-[^/]+/${project.id}/wiki-agents/one$`));
      expect(one!.directory).toBe(one!.path);
      expect(branches(repo)).toEqual(["main", "wiki-agents/one", "wiki-agents/two"]);
      expect(yield* availability(project.id)).toEqual({ available: true, unavailableReason: null });

      expect((yield* turn(first.id, "write app.ts two"))).toMatchObject({ outcome: "completed" });
      yield* turn(second.id, "write new.ts fresh");
      const session = sessionOf(first.id);
      expect(session.cwd).toBe(one!.directory);
      // The worktree takes the main directory's place; the main directory is outside the thread.
      expect(session.setup.projectRoots).toEqual([one!.directory, extra, sharedRoot]);
      const instruction = session.setup.instructions.at(-1)!;
      expect(instruction).toMatchObject({ source: "project", path: one!.directory });
      expect(instruction.text).toContain("branch wiki-agents/one");
      expect(instruction.text).toContain(`main checkout (${repo})`);

      expect(readFileSync(join(one!.directory, "app.ts"), "utf8")).toBe("two\n");
      expect(readFileSync(join(repo, "app.ts"), "utf8")).toBe("one\n");
      expect(existsSync(join(two!.directory, "new.ts"))).toBe(true);
      expect(existsSync(join(repo, "new.ts"))).toBe(false);
      expect(git(repo, "status", "--porcelain")).toBe("");

      // Each worktree is its own directory in the Diff view, labelled with its thread and branch.
      const diff = yield* getDiff(project.id);
      expect(diff.map((entry) => [entry.directory, entry.worktree ?? null])).toEqual([
        [repo, null],
        [extra, null],
        [one!.directory, { threadId: first.id, branch: "wiki-agents/one" }],
        [two!.directory, { threadId: second.id, branch: "wiki-agents/two" }],
      ]);
      expect(diff[0]!.files).toEqual([]);
      expect(diff[2]!.files.map((file) => [file.path, file.status])).toEqual([["app.ts", "modified"]]);
      expect(diff[3]!.files.map((file) => [file.path, file.status])).toEqual([["new.ts", "untracked"]]);
      const file = yield* HttpClient.get(`/api/projects/${project.id}/diff/file?${new URLSearchParams({ directory: one!.directory, path: "app.ts" })}`).pipe(
        Effect.flatMap(decode(GetFileDiffResponse)),
      );
      expect(file.file.diff).toBe("@@ -1 +1 @@\n-one\n+two");
      expect((yield* worktrees(project.id)).map((worktree) => worktree.changedFiles)).toEqual([1, 1]);

      // A thread without a worktree still runs in the main directory.
      const plain = yield* createThread(vault.id, { projectId: project.id });
      yield* turn(plain.id, "write plain.ts main");
      expect(sessionOf(plain.id).cwd).toBe(repo);
      expect(sessionOf(plain.id).setup.projectRoots).toEqual([repo, extra, sharedRoot]);
    }));

  test.effect("runs a manager's child in its existing worktree and branch", () => Effect.gen(function* () {
    const vault = yield* shared;
    const dir = yield* temp;
    const repo = repository(join(dir, "repo"), { "app.ts": "main\n" });
    const project = yield* register({ name: "Manager worktree", workingDirectories: [repo] });
    const agentId = "worktree-manager";
    const agent = {
      name: agentId, description: "", provider: null, model: null, sources: [], mcp: [],
      autonomy: { ...DEFAULT_AUTONOMY, threads: "allow" }, instructions: "Manage child threads.",
    };
    yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${agentId}`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ agent, baseHash: null }),
    )).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));

    const manager = yield* createThread(vault.id, { agentId, projectId: project.id, worktree: { branch: "manager" } });
    const events = yield* watch(manager.id);
    yield* sendOk(manager.id, "wait");
    yield* events.until(isTag("request.opened"));
    const tools = yield* mcpSession(sessionOf(manager.id).setup.vaultTools!.token);
    const child = yield* tools.result<{ threadId: string }>("thread_create", { title: "Write app", prompt: "write app.ts child" });

    const path = sessionOf(manager.id).cwd;
    expect(sessionOf(child.threadId).cwd).toBe(path);
    expect((yield* getThread(child.threadId)).thread).toMatchObject({ parentThreadId: manager.id, projectId: project.id });
    expect(git(path, "branch", "--show-current").trim()).toBe("manager");
    expect(readFileSync(join(path, "app.ts"), "utf8")).toBe("child\n");
    expect(readFileSync(join(repo, "app.ts"), "utf8")).toBe("main\n");
    expect(yield* interrupt(manager.id)).toMatchObject({ status: 200 });
  }));

  test.effect("gives worktrees the main directory's ignored files, in the Diff view and the agent's tool", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n", "local.env": "A=1\n" });
      const project = yield* register({ name: "Ignoring", workingDirectories: [repo] });
      const thread = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "ignoring" } });
      const [worktree] = yield* worktrees(project.id);
      yield* post(`/api/projects/${project.id}/diff/ignored`, { directory: repo, path: "local.env" }).pipe(Effect.flatMap(decode(IgnoreFileResponse)));
      // Ignoring a file in the worktree keeps it against the main directory.
      const ignored = yield* post(`/api/projects/${project.id}/diff/ignored`, { directory: worktree!.directory, path: "notes.txt" }).pipe(
        Effect.flatMap(decode(IgnoreFileResponse)),
      );
      expect(ignored.ignored).toEqual([{ directory: repo, path: "local.env" }, { directory: repo, path: "notes.txt" }]);

      yield* turn(thread.id, "write local.env A=2");
      const diff = (yield* getDiff(project.id)).find((entry) => entry.worktree !== undefined)!;
      expect(diff.ignored).toEqual(["local.env", "notes.txt"]);
      expect(diff.files.map((file) => file.path)).toEqual(["local.env"]);
      expect((yield* worktrees(project.id))[0]!.changedFiles).toBe(0);

      const mcp = yield* mcpSession(sessionOf(thread.id).setup.vaultTools!.token);
      expect(yield* mcp.result("project_ignored_files", {})).toMatchObject({
        project: "Ignoring",
        files: [{ directory: worktree!.directory, path: "local.env" }, { directory: worktree!.directory, path: "notes.txt" }],
      });
    }));

  test.effect("works in the worktree's counterpart of a main directory nested in its repository", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const repo = repository(join(yield* temp, "mono"), { "apps/web/page.ts": "page\n", "root.ts": "root\n" });
      const web = join(repo, "apps", "web");
      const project = yield* register({ name: "Mono", workingDirectories: [web] });
      const thread = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "nested" } });
      const [worktree] = yield* worktrees(project.id);
      expect(worktree!.directory).toBe(join(worktree!.path, "apps", "web"));
      yield* turn(thread.id, "write page.ts page 2");
      expect(sessionOf(thread.id).cwd).toBe(worktree!.directory);
      expect(readFileSync(join(worktree!.path, "apps", "web", "page.ts"), "utf8")).toBe("page 2\n");
      expect((yield* getDiff(project.id)).at(-1)!.files.map((file) => file.path)).toEqual(["page.ts"]);
    }));

  test.effect("removes a worktree only when git agrees, keeping the branch, and the thread then fails its turns", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n" });
      const project = yield* register({ name: "Removing", workingDirectories: [repo] });
      const thread = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "wiki-agents/removing" } });
      const [worktree] = yield* worktrees(project.id);

      // Refused while a turn waits for an answer.
      const waiting = yield* watch(thread.id);
      yield* sendOk(thread.id, "wait");
      yield* waiting.until(isTag("request.opened"), "1 minute");
      const busy = yield* removeWorktree(thread.id);
      expect(busy.status).toBe(409);
      expect(yield* busy.text).toMatch(/Stop the turn/);
      yield* interrupt(thread.id);

      // git refuses while there are uncommitted changes; its message is shown, nothing is removed.
      yield* turn(thread.id, "write app.ts two");
      const refused = yield* removeWorktree(thread.id);
      expect(refused.status).toBe(409);
      const refusal = yield* refused.text;
      expect(refusal).toMatch(/contains modified or untracked files\. Commit or discard them first/);
      expect(refusal).not.toMatch(/use --force/);
      expect(existsSync(worktree!.directory)).toBe(true);

      git(worktree!.directory, "commit", "-q", "-am", "agent's work");
      const removed = yield* removeWorktree(thread.id).pipe(Effect.flatMap(decode(RemoveWorktreeResponse)));
      expect(removed.worktree).toMatchObject({ threadId: thread.id, branch: "wiki-agents/removing" });
      expect(removed.worktree.removedAt).not.toBeNull();
      expect(existsSync(worktree!.path)).toBe(false);
      // Empty folders left by the branch's name go too.
      expect(existsSync(dirname(worktree!.path))).toBe(false);
      expect(branches(repo)).toEqual(["main", "wiki-agents/removing"]);
      expect(git(repo, "log", "-1", "--format=%s", "wiki-agents/removing").trim()).toBe("agent's work");
      // Removing again changes nothing.
      const again = yield* removeWorktree(thread.id).pipe(Effect.flatMap(decode(RemoveWorktreeResponse)));
      expect(again.worktree.removedAt).toBe(removed.worktree.removedAt);

      expect(yield* worktrees(project.id)).toEqual([expect.objectContaining({ exists: false, changedFiles: null })]);
      expect((yield* getDiff(project.id)).map((entry) => entry.directory)).toEqual([repo]);
      const failed = yield* turn(thread.id, "write app.ts three");
      expect(failed).toMatchObject({ outcome: "failed" });
      expect(failed._tag === "turn.finished" ? failed.reason : null).toMatch(/worktree \(branch wiki-agents\/removing\) was removed/);
      expect(existsSync(join(repo, "app.ts")) && readFileSync(join(repo, "app.ts"), "utf8")).toBe("one\n");

      const none = yield* createThread(vault.id, { projectId: project.id });
      expect((yield* removeWorktree(none.id)).status).toBe(404);
    }));

  test.effect("continues a worktree thread where you choose: sharing its worktree, the main directory, or a new worktree", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n" });
      const project = yield* register({ name: "Continuing", workingDirectories: [repo] });
      const source = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "wiki-agents/source" } });
      const [worktree] = yield* worktrees(project.id);
      // Uncommitted work the continuation must see when it shares the worktree.
      yield* turn(source.id, "write app.ts two");

      const sharing = yield* continueOk(source.id, { text: "## Objective\nCarry on." });
      expect(sharing).toMatchObject({ projectId: project.id, continuedFrom: source.id });
      yield* turn(sharing.id, "write more.ts three");
      expect(sessionOf(sharing.id).cwd).toBe(worktree!.directory);
      expect(sessionOf(sharing.id).setup.instructions.at(-1)!.text).toContain("branch wiki-agents/source");
      expect(readFileSync(join(worktree!.directory, "app.ts"), "utf8")).toBe("two\n");
      expect(readFileSync(join(worktree!.directory, "more.ts"), "utf8")).toBe("three\n");
      // Still one worktree, the source's, which the new thread shares; no new branch.
      expect(yield* worktrees(project.id)).toEqual([expect.objectContaining({ threadId: source.id, sharedWith: [sharing.id], changedFiles: 2 })]);
      expect(branches(repo)).toEqual(["main", "wiki-agents/source"]);

      const inMain = yield* continueOk(source.id, { text: "x", workspace: "main" });
      yield* turn(inMain.id, "write main.ts four");
      expect(sessionOf(inMain.id).cwd).toBe(repo);

      const fresh = yield* continueOk(source.id, { text: "x", workspace: { worktree: { branch: "wiki-agents/fresh" } } });
      const own = (yield* worktrees(project.id)).find((each) => each.threadId === fresh.id)!;
      yield* turn(fresh.id, "write fresh.ts five");
      expect(sessionOf(fresh.id).cwd).toBe(own.directory);
      // A clean checkout from HEAD: none of the source's uncommitted work.
      expect(readFileSync(join(own.directory, "app.ts"), "utf8")).toBe("one\n");
      expect((yield* getThread(source.id)).thread.continuedIn).toBe(fresh.id);

      git(worktree!.directory, "add", "-A");
      git(worktree!.directory, "commit", "-q", "-m", "work");
      // Not while the other thread in it has a turn waiting: its folder would go from under it.
      const waiting = yield* watch(sharing.id);
      yield* sendOk(sharing.id, "wait");
      yield* waiting.until(isTag("request.opened"), "1 minute");
      const inUse = yield* removeWorktree(source.id);
      expect(inUse.status).toBe(409);
      expect(yield* inUse.text).toMatch(/Another thread works in this worktree and has a turn running or waiting/);
      expect(existsSync(worktree!.directory)).toBe(true);
      yield* interrupt(sharing.id);

      // Removing the shared worktree from the new thread removes it for both.
      const removed = yield* removeWorktree(sharing.id).pipe(Effect.flatMap(decode(RemoveWorktreeResponse)));
      expect(removed.worktree).toMatchObject({ threadId: source.id, branch: "wiki-agents/source" });
      const failed = yield* turn(source.id, "write app.ts six");
      expect(failed._tag === "turn.finished" ? failed.reason : null).toMatch(/worktree \(branch wiki-agents\/source\) was removed/);
      const refused = yield* continueThread(source.id, { text: "x" });
      expect(refused.status).toBe(409);
      expect(yield* refused.text).toMatch(/worktree \(branch wiki-agents\/source\) is gone, so the new thread can't share it/);
    }));

  test.effect("fails the turn of a thread whose worktree was deleted outside the app, rather than using the main directory", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const repo = repository(join(yield* temp, "repo"), { "app.ts": "one\n" });
      const project = yield* register({ name: "Deleted", workingDirectories: [repo] });
      const thread = yield* createThread(vault.id, { projectId: project.id, worktree: { branch: "deleted" } });
      const [worktree] = yield* worktrees(project.id);
      rmSync(worktree!.path, { recursive: true, force: true });
      const failed = yield* turn(thread.id, "write app.ts two");
      expect(failed).toMatchObject({ outcome: "failed" });
      expect(failed._tag === "turn.finished" ? failed.reason : null).toMatch(/is missing from .*deleted outside the app/);
      expect(readFileSync(join(repo, "app.ts"), "utf8")).toBe("one\n");
      expect(yield* worktrees(project.id)).toEqual([expect.objectContaining({ exists: false, removedAt: null })]);
      // Removing it only records that it's gone.
      const removed = yield* removeWorktree(thread.id).pipe(Effect.flatMap(decode(RemoveWorktreeResponse)));
      expect(removed.worktree.removedAt).not.toBeNull();
      expect((yield* getThread(thread.id)).thread.id).toBe(thread.id);
    }));

  test.effect("makes no thread when a worktree can't be made, saying why", () =>
    Effect.gen(function* () {
      const vault = yield* shared;
      const dir = yield* temp;
      const repo = repository(join(dir, "repo"), { "app.ts": "one\n" });
      git(repo, "branch", "taken");
      const project = yield* register({ name: "Refusing", workingDirectories: [repo] });
      const refuse = (body: unknown) => post(`/api/vaults/${vault.id}/threads`, body);

      const taken = yield* refuse({ projectId: project.id, worktree: { branch: "taken" } });
      expect(taken.status).toBe(409);
      expect(yield* taken.text).toMatch(/a branch named 'taken' already exists/);
      for (const branch of ["two words", "-x", "a..b", ""]) {
        const invalid = yield* refuse({ projectId: project.id, worktree: { branch } });
        expect(invalid.status).toBe(409);
        expect(yield* invalid.text).toMatch(/isn't a valid branch name/);
      }

      const plain = join(dir, "plain");
      mkdirSync(plain);
      const outsideGit = yield* register({ name: "Plain", workingDirectories: [plain] });
      const notGit = yield* refuse({ projectId: outsideGit.id, worktree: { branch: "x" } });
      expect(notGit.status).toBe(400);
      expect(yield* notGit.text).toMatch(/isn't in a git repository/);

      const fresh = join(dir, "fresh");
      mkdirSync(fresh);
      git(fresh, "init", "-q");
      const unborn = yield* register({ name: "Fresh", workingDirectories: [fresh] });
      expect((yield* refuse({ projectId: unborn.id, worktree: { branch: "x" } })).status).toBe(400);

      const vaultOnly = yield* register({ name: "Notes", workingDirectories: [], notesFolder: "Projects" });
      const inVault = yield* refuse({ projectId: vaultOnly.id, worktree: { branch: "x" } });
      expect(inVault.status).toBe(400);
      expect(yield* inVault.text).toMatch(/not folders in the shared vault/);

      expect((yield* refuse({ worktree: { branch: "x" } })).status).toBe(400);

      expect(yield* availability(project.id)).toEqual({ available: true, unavailableReason: null });
      expect((yield* availability(outsideGit.id)).unavailableReason).toMatch(/isn't in a git repository/);
      expect((yield* availability(unborn.id)).unavailableReason).toMatch(/last commit/);
      expect(yield* availability(vaultOnly.id)).toMatchObject({ available: false, unavailableReason: expect.stringMatching(/shared vault/) });
      expect(yield* threadIds(vault.id, project.id)).toEqual([]);
      expect(yield* threadIds(vault.id, outsideGit.id)).toEqual([]);
      expect(yield* worktrees(project.id)).toEqual([]);
      expect(branches(repo)).toEqual(["main", "taken"]);
    }));
});
