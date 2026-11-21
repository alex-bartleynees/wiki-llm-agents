import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it, layer } from "@effect/vitest";
import { DEFAULT_AUTONOMY, type AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Effect, Fiber, Layer, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { makeHttpApp } from "../../src/app/layers.js";
import { makeAgentCatalog } from "../../src/features/agents/catalog-live.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { ReplayOnly, TestApp, TestAttachments, TestSecrets, TestWorktrees } from "./infrastructure/test-app.js";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { makeTestVault } from "./infrastructure/test-vault.js";
import { answer, decode, getThread, interrupt, isTag, newThread, newVault, post, requestIdOf, sendOk, setAgent, watch } from "./infrastructure/threads.js";

const setup = Effect.fnUntraced(function* (permission: AutonomyLevel, existingVault?: { readonly id: string }) {
  const vault = existingVault ?? (yield* newVault);
  const manager = yield* newThread(vault.id);
  const agentId = `manager-${manager.id.slice(0, 8)}`;
  const agent = {
    name: agentId, description: "", provider: null, model: null, sources: [], mcp: [],
    autonomy: { ...DEFAULT_AUTONOMY, threads: permission },
    instructions: "Manage child threads.",
  };
  yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${agentId}`).pipe(
    HttpClientRequest.bodyJsonUnsafe({ agent, baseHash: null }),
  )).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));
  yield* setAgent(manager.id, agentId);
  const mcp = yield* mcpSession((yield* tokenFor(manager.id, vault.id)).token);
  const events = yield* watch(manager.id);
  yield* sendOk(manager.id, "Ask me a question");
  const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
  return { vault, manager, mcp, events, agentId, requestId };
});

const task = { title: "Read the plan", prompt: "Ask me a question" };

layer(TestApp)("manager thread tools", (it) => {
  it.effect("checks ownership, runs children as app threads, and limits concurrent work", () => Effect.gen(function* () {
    const { vault, manager, mcp, agentId } = yield* setup("allow");
    const available = yield* mcp.rpc("tools/list");
    expect(available.result).toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: "thread_create" })]) });
    const child = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", task);
    const events = yield* watch(child.threadId);
    const detail = yield* getThread(child.threadId);
    expect(detail.thread).toMatchObject({ parentThreadId: manager.id, agentId, title: task.title, vaultId: vault.id });
    const childMcp = yield* mcpSession((yield* tokenFor(child.threadId, vault.id)).token);
    const childTools = yield* childMcp.rpc("tools/list");
    expect(childTools.result).not.toMatchObject({ tools: expect.arrayContaining([expect.objectContaining({ name: "thread_create" })]) });
    expect(yield* childMcp.callError("thread_create", task)).toBeTruthy();
    expect((yield* mcp.call("thread_read", { threadId: manager.id })).isError).toBe(true);
    expect((yield* mcp.call("thread_send", { threadId: child.threadId, prompt: "Try again" })).isError).toBe(true);
    const others = yield* Effect.forEach([1, 2, 3, 4], () => mcp.call("thread_create", task), { concurrency: "unbounded" });
    expect(others.filter((result) => !result.isError)).toHaveLength(3);

    const pending = yield* events.until(isTag("request.opened"));
    yield* answer(child.threadId, requestIdOf(pending), { _tag: "question", text: "_Inbox/" });
    yield* events.until(isTag("turn.finished"));
    expect(yield* mcp.result("thread_read", { threadId: child.threadId })).toMatchObject({ reply: expect.stringContaining("_Inbox/"), outcome: "completed" });
    expect(yield* mcp.result("thread_send", { threadId: child.threadId, prompt: task.prompt })).toMatchObject({ threadId: child.threadId });
    expect(yield* mcp.result("thread_list")).toMatchObject({ children: expect.arrayContaining([expect.objectContaining({ threadId: child.threadId })]) });
  }));

  it.effect("batches completed child turns after the busy manager finishes", () => Effect.gen(function* () {
    const { manager, mcp, events, requestId } = yield* setup("allow");
    const first = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", { ...task, title: "Check the plan" });
    const second = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", { ...task, title: "Read the notes" });
    const children = [first, second];
    const watchers = yield* Effect.forEach(children, (child) => watch(child.threadId));
    for (const [index, child] of children.entries()) {
      const childEvents = watchers[index]!;
      const pending = yield* childEvents.until(isTag("request.opened"));
      yield* answer(child.threadId, requestIdOf(pending), { _tag: "question", text: "_Inbox/" });
      yield* childEvents.until(isTag("turn.finished"));
    }
    expect((yield* getThread(manager.id)).events.map(({ event }) => event)).not.toContainEqual(expect.objectContaining({
      childReports: expect.anything(),
    }));
    yield* answer(manager.id, requestId, { _tag: "question", text: "Continue" });
    yield* events.until(isTag("turn.finished"));
    const report = yield* events.until((event) => event._tag === "user.message" && event.childReports !== undefined);
    expect(report).toContainEqual(expect.objectContaining({
      childReports: expect.arrayContaining(children.map(({ turnId }) => turnId)),
      text: expect.stringContaining("Check the plan"),
    }));
  }));

  it.effect("stops a waiting child when the manager stops", () => Effect.gen(function* () {
    const { manager, mcp } = yield* setup("allow");
    const child = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", task);
    const events = yield* watch(child.threadId);
    yield* events.until(isTag("request.opened"));
    expect((yield* interrupt(manager.id)).status).toBe(200);
    expect((yield* getThread(child.threadId)).thread.lastTurn?.outcome).toBe("interrupted");
    expect((yield* getThread(manager.id)).thread.status).toBe("idle");
  }));

  it.effect("asks before creating a child and leaves the list empty when denied", () => Effect.gen(function* () {
    const { manager, mcp, events } = yield* setup("ask");
    const pending = yield* Effect.forkChild(mcp.call("thread_create", task));
    const seen = yield* events.until(isTag("request.opened"));
    expect(seen.find(isTag("request.opened"))).toMatchObject({
      prompt: { title: "Start child thread", detail: expect.stringContaining(task.prompt) },
    });
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "deny" });
    expect((yield* Fiber.join(pending)).isError).toBe(true);
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
  }));
});

it.effect("recovers an undelivered child report and records it once across restarts", () => Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-manager-threads-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );
  const { root } = yield* makeTestVault({ files: { "index.md": "# Home" } });
  const app = () => makeHttpApp({
    vaults: [], watch: false, providers: ReplayOnly, agents: makeAgentCatalog({ dir: join(dir, "config"), watch: false }),
    attachments: TestAttachments, worktrees: TestWorktrees, secrets: TestSecrets,
  }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({
      file: join(dir, "app.db"), migrationsDir: fileURLToPath(new URL("../../drizzle", import.meta.url)),
    }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
  const run = <A, E>(body: Effect.Effect<A, E, Layer.Success<ReturnType<typeof app>> | Scope.Scope>) =>
    Effect.scoped(Effect.provide(body, app()));

  const { managerId, childTurnId, requestId } = yield* run(Effect.gen(function* () {
    const { vault } = yield* post("/api/vaults", { rootPath: root }).pipe(Effect.flatMap(decode(RegisterVaultResponse)));
    const { manager, mcp, requestId } = yield* setup("allow", vault);
    const child = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", { ...task, title: "Worker" });
    const events = yield* watch(child.threadId);
    const pending = yield* events.until(isTag("request.opened"));
    yield* answer(child.threadId, requestIdOf(pending), { _tag: "question", text: "_Inbox/" });
    yield* events.until(isTag("turn.finished"));
    expect((yield* getThread(manager.id)).events.map(({ event }) => event)).not.toContainEqual(expect.objectContaining({
      childReports: expect.anything(),
    }));
    return { managerId: manager.id, childTurnId: child.turnId, requestId };
  }));

  yield* run(Effect.gen(function* () {
    yield* (yield* ThreadActors).wake(managerId);
    const events = yield* watch(managerId);
    expect((yield* answer(managerId, requestId, { _tag: "question", text: "Continue" })).status).toBe(200);
    yield* events.until(isTag("turn.finished"));
    const reported = yield* events.until((event) => event._tag === "user.message" && event.childReports !== undefined);
    expect(reported).toContainEqual(expect.objectContaining({ childReports: [childTurnId] }));
  }));

  yield* run(Effect.gen(function* () {
    const actors = yield* ThreadActors;
    yield* actors.wake(managerId);
    yield* actors.childReports(managerId);
    yield* TestClock.adjust("1 minute");
    yield* actors.whileIdle(managerId, Effect.void);
    const { events } = yield* getThread(managerId);
    expect(events.flatMap(({ event }) => event._tag === "user.message" ? event.childReports ?? [] : [])).toEqual([childTurnId]);
  }));
}));
