import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { afterAll } from "vitest";
import { ArchiveProjectResponse } from "@wiki-agents/contracts/projects/archive-project/response";
import { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { ListProjectsResponse } from "@wiki-agents/contracts/projects/list-projects/response";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { RestoreProjectResponse } from "@wiki-agents/contracts/projects/restore-project/response";
import { ReviewChangesResponse } from "@wiki-agents/contracts/projects/review-changes/response";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import { ListVaultsResponse } from "@wiki-agents/contracts/vaults/list-vaults/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { Effect, Layer, Scope } from "effect";
import { HttpClient } from "effect/http";
import { makeHttpApp } from "../../src/app/layers.js";
import type { OpenSessionInput } from "../../src/features/providers/port.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { mcpSession } from "./infrastructure/mcp.js";
import { makeTestApp, TestAgents } from "./infrastructure/test-app.js";
import { decode, getThread, isTag, newVault, post, sendOk, watch } from "./infrastructure/threads.js";

/** The replay provider, recording every session it opens. */
const opened: Array<OpenSessionInput> = [];
const providers = makeProviderRegistry(Effect.succeed([{
  ...ReplayAdapter,
  openSession: (input: OpenSessionInput) => Effect.gen(function* () {
    opened.push(input);
    return yield* ReplayAdapter.openSession(input);
  }),
}]));

/** A canonical temp folder, removed afterwards. */
const temp = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), "wiki-projects-")))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);
/** New folders in `dir`, as absolute paths. */
const folders = <const Names extends ReadonlyArray<string>>(dir: string, ...names: Names) =>
  names.map((name) => {
    mkdirSync(join(dir, name));
    return join(dir, name);
  }) as { readonly [K in keyof Names]: string };

const register = (body: unknown) => post("/api/projects", body).pipe(Effect.flatMap(decode(RegisterProjectResponse)), Effect.map((result) => result.project));
const changes = (id: string) => HttpClient.get(`/api/projects/${id}/changes`).pipe(Effect.flatMap(decode(ListChangesResponse)), Effect.map((result) => result.changes));
const review = (id: string) => post(`/api/projects/${id}/changes/review`, {}).pipe(Effect.flatMap(decode(ReviewChangesResponse)));
const createThread = (vaultId: string, body: unknown) =>
  post(`/api/vaults/${vaultId}/threads`, body).pipe(Effect.flatMap(decode(CreateThreadResponse)), Effect.map((result) => result.thread));
const listThreads = (vaultId: string, query = "") =>
  HttpClient.get(`/api/vaults/${vaultId}/threads${query}`).pipe(Effect.flatMap(decode(ListThreadsResponse)), Effect.map((result) => result.threads.map((thread) => thread.id).sort()));
/**
 * Runs one turn so the provider opens the thread's session, and returns that session.
 * The replay plays within a minute of test time, well inside the idle actor's
 * lifetime, so its vault tools token is still live afterwards.
 */
const sessionOf = (threadId: string) => Effect.gen(function* () {
  const events = yield* watch(threadId);
  yield* sendOk(threadId, "hello");
  yield* events.until(isTag("turn.finished"), "1 minute");
  return opened.findLast((input) => input.threadId === threadId)!;
});

/** The shared vault: registered at startup, so before any vault a test adds. */
const sharedRoot = realpathSync(mkdtempSync(join(tmpdir(), "wiki-projects-vault-")));
writeFileSync(join(sharedRoot, "index.md"), "# Shared");
writeFileSync(join(sharedRoot, "Coffee.md"), "# Coffee\n\nFlat whites.");
afterAll(() => rmSync(sharedRoot, { recursive: true, force: true }));
const shared = HttpClient.get("/api/vaults").pipe(
  Effect.flatMap(decode(ListVaultsResponse)),
  Effect.map(({ vaults }) => vaults.find((vault) => vault.rootPath === sharedRoot)!),
);

layer(makeTestApp({ providers, vaults: [sharedRoot] }))("projects", (test) => {

  test.effect("registers existing folders in order without duplicates, using the shared vault", () => Effect.gen(function* () {
    const vault = yield* shared;
    yield* newVault; // a second vault doesn't stop projects or change which one is shared
    const dir = yield* temp;
    const [repo, extra] = folders(dir, "repo", "extra");
    mkdirSync(join(vault.rootPath, "App Notes"));
    const project = yield* register({ name: " App ", workingDirectories: [repo, `${extra}/`, repo], notesFolder: "App Notes" });
    expect(project).toMatchObject({ name: "App", vaultId: vault.id, workingDirectories: [repo, extra], notesFolder: "App Notes" });
    const { projects } = yield* HttpClient.get("/api/projects").pipe(Effect.flatMap(decode(ListProjectsResponse)));
    expect(projects).toContainEqual(project);
  }));

  test.effect("creates missing folders only when asked, and only once the whole request is valid", () => Effect.gen(function* () {
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    writeFileSync(join(repo, "file.txt"), "a file");
    const fresh = join(dir, "new", "app");
    expect((yield* post("/api/projects", { name: "X", workingDirectories: [fresh] })).status).toBe(400);
    expect((yield* post("/api/projects", { name: "X", workingDirectories: [fresh, join(repo, "file.txt")], createDirectories: true })).status).toBe(400);
    expect((yield* post("/api/projects", { name: "X", workingDirectories: [fresh], createDirectories: true, notesFolder: "Missing" })).status).toBe(400);
    expect(existsSync(join(dir, "new"))).toBe(false);
    const created = yield* register({ name: "New", workingDirectories: [repo, fresh], createDirectories: true });
    expect(created.workingDirectories).toEqual([repo, fresh]);
    expect(existsSync(fresh)).toBe(true);
  }));

  test.effect("refuses bad names and paths, folders too broad to scan, and notes outside the vault", () => Effect.gen(function* () {
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    writeFileSync(join(repo, "app.ts"), "");
    for (const body of [
      { name: "  ", workingDirectories: [repo] },
      { name: "X", workingDirectories: [] },
      { name: "X", workingDirectories: ["relative"] },
      { name: "X", workingDirectories: [join(dir, "missing")] },
      { name: "X", workingDirectories: [join(repo, "app.ts")] },
      { name: "X", workingDirectories: ["/"] },
      { name: "X", workingDirectories: ["~"] },
      { name: "X", workingDirectories: [homedir()] },
      { name: "X", workingDirectories: [repo], notesFolder: "../outside" },
    ]) expect((yield* post("/api/projects", body)).status).toBe(400);
  }));

  test.effect("registers a vault-only project that works in its notes folder", () => Effect.gen(function* () {
    const vault = yield* shared;
    const notes = join(vault.rootPath, "Move Plan");
    mkdirSync(notes);
    writeFileSync(join(notes, "Checklist.md"), "# Checklist");
    expect((yield* post("/api/projects", { name: "X", workingDirectories: [], notesFolder: "Missing" })).status).toBe(400);
    const project = yield* register({ name: "Move", workingDirectories: [], notesFolder: "Move Plan" });
    expect(project).toMatchObject({ workingDirectories: [notes], notesFolder: "Move Plan" });

    const thread = yield* createThread(vault.id, { projectId: project.id });
    const session = yield* sessionOf(thread.id);
    expect(session.cwd).toBe(notes);
    expect(session.setup.projectRoots).toEqual([notes, vault.rootPath]);
    writeFileSync(join(notes, "Checklist.md"), "# Checklist\n\n- [ ] Book movers");
    expect(yield* changes(project.id)).toEqual([{ directory: notes, path: "Checklist.md", status: "modified" }]);
  }));

  test.effect("runs project threads in the main directory with the shared vault's tools, kept apart from other threads", () => Effect.gen(function* () {
    const vault = yield* shared;
    const dir = yield* temp;
    const [repo, extra, other] = folders(dir, "repo", "extra", "other");
    const app = yield* register({ name: "App", workingDirectories: [repo, extra] });
    const second = yield* register({ name: "Other", workingDirectories: [other] });
    const thread = yield* createThread(vault.id, { projectId: app.id });
    const another = yield* createThread(vault.id, { projectId: second.id });
    const plain = yield* createThread(vault.id, {});
    expect([thread.projectId, another.projectId, plain.projectId]).toEqual([app.id, second.id, null]);

    expect(yield* listThreads(vault.id, `?projectId=${app.id}`)).toEqual([thread.id]);
    expect(yield* listThreads(vault.id, `?projectId=${second.id}`)).toEqual([another.id]);
    const vaultOnly = yield* listThreads(vault.id, "?projectId=none");
    expect(vaultOnly).toContain(plain.id);
    expect(vaultOnly).not.toContain(thread.id);
    // Without a scope, every thread in the vault, as before projects.
    expect(yield* listThreads(vault.id)).toEqual(expect.arrayContaining([thread.id, another.id, plain.id]));

    const session = yield* sessionOf(thread.id);
    expect(session.cwd).toBe(repo);
    expect(session.setup.projectRoots).toEqual([repo, extra, vault.rootPath]);
    expect(session.setup.instructions.at(-1)).toMatchObject({ source: "project", path: repo });
    expect(session.setup.instructions.at(-1)?.text).toContain('"App"');
    // Its own vault tools read the shared vault's notes.
    const mcp = yield* mcpSession(session.setup.vaultTools!.token);
    expect(yield* mcp.result("vault_note_info", { path: "Coffee.md" })).toMatchObject({ path: "Coffee.md", title: "Coffee" });
    const otherSession = yield* sessionOf(another.id);
    expect(otherSession.cwd).toBe(other);
    expect(otherSession.setup.projectRoots).toEqual([other, vault.rootPath]);
    expect(otherSession.setup.vaultTools?.name).not.toBe(session.setup.vaultTools?.name);
    expect(otherSession.setup.instructions.map((instruction) => instruction.text).join()).not.toContain('"App"');
    const plainSession = yield* sessionOf(plain.id);
    expect(plainSession.cwd).toBe(vault.rootPath);
    expect(plainSession.setup.projectRoots).toBeNull();
  }));

  test.effect("refuses threads for a missing project or one using another vault", () => Effect.gen(function* () {
    const vault = yield* shared;
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    const project = yield* register({ name: "Scoped", workingDirectories: [repo] });
    expect((yield* post(`/api/vaults/${vault.id}/threads`, { projectId: "missing" })).status).toBe(404);
    const otherVault = yield* newVault;
    expect((yield* post(`/api/vaults/${otherVault.id}/threads`, { projectId: project.id })).status).toBe(400);
  }));

  test.effect("archives a project, keeping its threads and changes but refusing new threads, until restored", () => Effect.gen(function* () {
    const vault = yield* shared;
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    writeFileSync(join(repo, "app.ts"), "before");
    const project = yield* register({ name: "Old", workingDirectories: [repo] });
    expect(project.archivedAt).toBeNull();
    const thread = yield* createThread(vault.id, { projectId: project.id });

    const archived = yield* post(`/api/projects/${project.id}/archive`, {}).pipe(Effect.flatMap(decode(ArchiveProjectResponse)));
    expect(archived.project).toMatchObject({ id: project.id, archivedAt: expect.any(Number) });
    // Archiving again keeps the first time.
    expect((yield* post(`/api/projects/${project.id}/archive`, {}).pipe(Effect.flatMap(decode(ArchiveProjectResponse)))).project).toEqual(archived.project);
    const { projects } = yield* HttpClient.get("/api/projects").pipe(Effect.flatMap(decode(ListProjectsResponse)));
    expect(projects).toContainEqual(archived.project);

    const refused = yield* post(`/api/vaults/${vault.id}/threads`, { projectId: project.id });
    expect(refused.status).toBe(400);
    expect(yield* refused.text).toMatch(/archived/);
    expect(yield* listThreads(vault.id, `?projectId=${project.id}`)).toEqual([thread.id]);
    writeFileSync(join(repo, "app.ts"), "after");
    expect(yield* changes(project.id)).toEqual([{ directory: repo, path: "app.ts", status: "modified" }]);

    const restored = yield* post(`/api/projects/${project.id}/restore`, {}).pipe(Effect.flatMap(decode(RestoreProjectResponse)));
    expect(restored.project).toEqual({ ...project, archivedAt: null });
    expect((yield* createThread(vault.id, { projectId: project.id })).projectId).toBe(project.id);
    expect((yield* post("/api/projects/missing/archive", {})).status).toBe(404);
    expect((yield* post("/api/projects/missing/restore", {})).status).toBe(404);
  }));

  test.effect("lists changed files in every folder, without symlinks or Git metadata, until marked reviewed", () => Effect.gen(function* () {
    const dir = yield* temp;
    const [repo, extra, outside] = folders(dir, "repo", "extra", "outside");
    writeFileSync(join(repo, "app.ts"), "before");
    writeFileSync(join(extra, "removed.txt"), "before");
    mkdirSync(join(repo, ".git"));
    mkdirSync(join(repo, "node_modules"));
    symlinkSync(outside, join(repo, "linked"));
    const project = yield* register({ name: "Changes", workingDirectories: [repo, extra] });
    expect(yield* changes(project.id)).toEqual([]);

    writeFileSync(join(repo, "app.ts"), "after");
    writeFileSync(join(repo, ".env"), "SECRET=1");
    writeFileSync(join(repo, ".git", "index"), "ignored");
    writeFileSync(join(repo, "node_modules", "dep.js"), "ignored");
    writeFileSync(join(outside, "through-link.txt"), "ignored");
    writeFileSync(join(extra, "new.txt"), "new");
    unlinkSync(join(extra, "removed.txt"));
    expect(yield* changes(project.id)).toEqual([
      { directory: extra, path: "new.txt", status: "created" },
      { directory: extra, path: "removed.txt", status: "deleted" },
      { directory: repo, path: ".env", status: "created" },
      { directory: repo, path: "app.ts", status: "modified" },
    ]);

    expect(yield* review(project.id)).toEqual({ files: 3 });
    expect(yield* changes(project.id)).toEqual([]);
    writeFileSync(join(extra, "new.txt"), "changed again");
    expect(yield* changes(project.id)).toEqual([{ directory: extra, path: "new.txt", status: "modified" }]);
    expect((yield* HttpClient.get("/api/projects/missing/changes")).status).toBe(404);
    expect((yield* post("/api/projects/missing/changes/review", {})).status).toBe(404);
  }));

  test.effect("leaves out what Git ignores, so dependency caches don't count, including in nested repositories and submodules", () => Effect.gen(function* () {
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    const git = (cwd: string, ...args: Array<string>) => execFileSync("git", args, { cwd, stdio: "ignore" });
    git(repo, "init", "-q");
    writeFileSync(join(repo, ".gitignore"), ".npm/\nbuild/\n");
    mkdirSync(join(repo, ".npm"));
    writeFileSync(join(repo, ".npm", "cached.tgz"), "ignored");
    writeFileSync(join(repo, "tracked.ts"), "tracked");
    writeFileSync(join(repo, "gone.ts"), "staged, then deleted");
    git(repo, "add", "tracked.ts", "gone.ts");
    unlinkSync(join(repo, "gone.ts"));
    writeFileSync(join(repo, "untracked.ts"), "untracked");
    const [nested] = folders(repo, "nested");
    git(nested, "init", "-q");
    writeFileSync(join(nested, ".gitignore"), "out/\n");
    mkdirSync(join(nested, "out"));
    writeFileSync(join(nested, "out", "bundle.js"), "ignored");
    writeFileSync(join(nested, "lib.ts"), "nested");
    // An uninitialised submodule: an empty folder that Git lists as itself.
    mkdirSync(join(repo, "submodule"));
    git(repo, "update-index", "--add", "--cacheinfo", "160000,0123456789abcdef0123456789abcdef01234567,submodule");
    // The whole project is ignored by the repository around it: Git lists nothing, so walk it.
    const [ignored] = folders(repo, "build");
    writeFileSync(join(ignored, "keep.txt"), "kept");

    const project = yield* register({ name: "Git", workingDirectories: [repo, ignored] });
    writeFileSync(join(repo, ".npm", "cached.tgz"), "changed");
    writeFileSync(join(nested, "out", "bundle.js"), "changed");
    expect(yield* changes(project.id)).toEqual([]);
    expect(yield* review(project.id)).toEqual({ files: 6 }); // .gitignore, tracked, untracked, nested .gitignore and lib, keep
    // Same size, written straight after the scan: the size and time alone can't show it changed.
    writeFileSync(join(repo, "tracked.ts"), "TRACKED");
    writeFileSync(join(nested, "lib.ts"), "NESTED");
    expect(yield* changes(project.id)).toEqual([
      { directory: repo, path: "nested/lib.ts", status: "modified" },
      { directory: repo, path: "tracked.ts", status: "modified" },
    ]);
  }));

  test.effect("reads only files whose size or modification time changed since the baseline", () => Effect.gen(function* () {
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    const old = new Date(Date.now() - 60_000);
    for (const name of ["kept.txt", "edited.txt"]) {
      writeFileSync(join(repo, name), "before");
      utimesSync(join(repo, name), old, old);
    }
    const project = yield* register({ name: "Stat", workingDirectories: [repo] });
    // Unreadable now, but unchanged by size and time, so the rescan never opens it.
    chmodSync(join(repo, "kept.txt"), 0o000);
    yield* Effect.addFinalizer(() => Effect.sync(() => chmodSync(join(repo, "kept.txt"), 0o644)));
    writeFileSync(join(repo, "edited.txt"), "after!");
    expect(yield* changes(project.id)).toEqual([{ directory: repo, path: "edited.txt", status: "modified" }]);
    expect(yield* review(project.id)).toEqual({ files: 2 });
  }));

  test.effect("reports a working directory that has gone instead of listing every file as deleted", () => Effect.gen(function* () {
    const dir = yield* temp;
    const [repo] = folders(dir, "repo");
    writeFileSync(join(repo, "file.txt"), "a file");
    const project = yield* register({ name: "Gone", workingDirectories: [repo] });
    rmSync(repo, { recursive: true });
    expect((yield* HttpClient.get(`/api/projects/${project.id}/changes`)).status).toBe(409);
  }));
});

describe("projects", () => {
  layer(makeTestApp({ providers }))("without a vault", (test) => {
    test.effect("asks for the shared vault first", () => Effect.gen(function* () {
      const dir = yield* temp;
      const [repo] = folders(dir, "repo");
      const response = yield* post("/api/projects", { name: "Early", workingDirectories: [repo] });
      expect(response.status).toBe(400);
      expect(yield* response.text).toMatch(/shared vault/);
    }));
  });
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const appOn = (file: string) => makeHttpApp({ vaults: [], watch: false, providers, agents: TestAgents }).pipe(
  Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
  Layer.provideMerge(NodeHttpServer.layerTest),
);
type App = Layer.Success<ReturnType<typeof appOn>>;
const run = <A, E>(file: string, body: Effect.Effect<A, E, App | Scope.Scope>) => Effect.scoped(Effect.provide(body, appOn(file)));

it.effect("restores project threads, their folder and the changed-file baseline after a restart", () => Effect.gen(function* () {
  const dir = yield* temp;
  const file = join(dir, "app.db");
  const [repo, vaultRoot] = folders(dir, "repo", "vault");
  writeFileSync(join(repo, "file.txt"), "before");
  writeFileSync(join(vaultRoot, "index.md"), "# Shared");
  const saved = yield* run(file, Effect.gen(function* () {
    const { vault } = yield* post("/api/vaults", { rootPath: vaultRoot }).pipe(Effect.flatMap(decode(RegisterVaultResponse)));
    const project = yield* register({ name: "Persistent", workingDirectories: [repo] });
    const thread = yield* createThread(vault.id, { projectId: project.id });
    yield* sessionOf(thread.id);
    return { project, thread };
  }));
  writeFileSync(join(repo, "file.txt"), "after restart");
  yield* run(file, Effect.gen(function* () {
    expect((yield* HttpClient.get("/api/projects").pipe(Effect.flatMap(decode(ListProjectsResponse)))).projects).toEqual([saved.project]);
    expect((yield* getThread(saved.thread.id)).thread.projectId).toBe(saved.project.id);
    expect(yield* changes(saved.project.id)).toEqual([{ directory: repo, path: "file.txt", status: "modified" }]);
    yield* sessionOf(saved.thread.id);
    expect(opened.filter((input) => input.threadId === saved.thread.id).map((input) => input.cwd)).toEqual([repo, repo]);
  }));
}).pipe(Effect.scoped));
