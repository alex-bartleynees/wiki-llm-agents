import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it, layer } from "@effect/vitest";
import { DEFAULT_AUTONOMY, type AutonomyLevel } from "@wiki-agents/contracts/agents/model";
import { Deferred, Effect, Fiber, Layer, Option, PubSub, type Scope } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { mcpSession, tokenFor } from "./infrastructure/mcp.js";
import { makeHttpApp } from "../../src/app/layers.js";
import { makeAgentCatalog } from "../../src/features/agents/catalog-live.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { makeTestApp, ReplayOnly, TestApp, TestAttachments, TestSecrets, TestWorktrees } from "./infrastructure/test-app.js";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { makeTestVault } from "./infrastructure/test-vault.js";
import { answer, decode, getThread, interrupt, isTag, markDone, newThread, reopen, newVault, post, requestIdOf, sendOk, setAgent, watch } from "./infrastructure/threads.js";

const putAgent = (id: string, agent: object, baseHash: string | null = null) =>
  HttpClient.execute(HttpClientRequest.put(`/api/agents/${id}`).pipe(
    HttpClientRequest.bodyJsonUnsafe({ agent, baseHash }),
  )).pipe(Effect.flatMap(HttpClientResponse.filterStatusOk));

const setup = Effect.fnUntraced(function* (
  permission: AutonomyLevel,
  existingVault?: { readonly id: string },
  options: { workers?: ReadonlyArray<string>; provider?: string; model?: string; threadProvider?: string; threadModel?: string; unattended?: boolean } = {},
) {
  const vault = existingVault ?? (yield* newVault);
  const { thread: manager } = yield* post(`/api/vaults/${vault.id}/threads`, {
    ...(options.threadProvider === undefined ? {} : { providerInstanceId: options.threadProvider }),
    ...(options.threadModel === undefined ? {} : { model: options.threadModel }),
  }).pipe(Effect.flatMap(decode(CreateThreadResponse)));
  const agentId = `manager-${manager.id.slice(0, 8)}`;
  const agent = {
    name: agentId, description: "", provider: options.provider ?? null, model: options.model ?? null, sources: [], mcp: [],
    ...(options.workers === undefined ? {} : { workers: options.workers }),
    autonomy: { ...DEFAULT_AUTONOMY, threads: permission },
    instructions: "Manage child threads.",
  };
  const saved = yield* putAgent(agentId, agent);
  const { hash } = (yield* saved.json) as { hash: string };
  yield* setAgent(manager.id, agentId);
  const mcp = yield* mcpSession((yield* tokenFor(manager.id, vault.id)).token);
  const events = yield* watch(manager.id);
  if (options.unattended === true) return { vault, manager, mcp, events, agentId, requestId: "", agent, hash };
  yield* sendOk(manager.id, "Ask me a question");
  const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
  return { vault, manager, mcp, events, agentId, requestId, agent, hash };
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

  it.effect("keeps an idle manager open while its child is waiting", () => Effect.gen(function* () {
    const { vault, manager, mcp, events, requestId } = yield* setup("allow");
    const child = yield* mcp.result<{ threadId: string; turnId: string }>("thread_create", { ...task, title: "Worker" });
    const childEvents = yield* watch(child.threadId);
    yield* childEvents.until(isTag("request.opened"));
    yield* answer(manager.id, requestId, { _tag: "question", text: "Wait for the child" });
    yield* events.until(isTag("turn.finished"), "5 seconds");
    expect((yield* getThread(manager.id)).thread.status).toBe("idle");

    yield* TestClock.adjust(1);
    const sentinel = yield* newThread(vault.id);
    const bus = yield* ThreadBus;
    const updates = yield* bus.subscribeThreads;
    const policy = (enabled: boolean) =>
      HttpClient.execute(HttpClientRequest.put("/api/settings/thread-inactivity").pipe(
        HttpClientRequest.bodyJsonUnsafe({ policy: { enabled, days: 1 } }),
      ));
    const waitForDone = (id: string) => Effect.gen(function* () {
      let thread = yield* PubSub.take(updates);
      while (thread.id !== id || thread.doneReason !== "inactivity") thread = yield* PubSub.take(updates);
    });

    yield* TestClock.adjust("1 day");
    expect((yield* policy(true)).status).toBe(200);
    yield* waitForDone(sentinel.id);
    expect((yield* getThread(manager.id)).thread.doneAt).toBeNull();
    expect((yield* getThread(child.threadId)).thread.doneAt).toBeNull();

    expect((yield* interrupt(manager.id)).status).toBe(200);
    expect((yield* getThread(child.threadId)).thread.lastTurn?.outcome).toBe("interrupted");
    expect((yield* getThread(manager.id)).thread.doneAt).toBeNull();
    yield* TestClock.adjust("1 day");
    expect((yield* policy(true)).status).toBe(200);
    yield* waitForDone(manager.id);
    expect((yield* policy(false)).status).toBe(200);
  }));

  it.effect("marks an idle manager and all its children done together", () => Effect.gen(function* () {
    const { manager, mcp, events, requestId } = yield* setup("allow");
    const first = yield* mcp.result<{ threadId: string }>("thread_create", task);
    const second = yield* mcp.result<{ threadId: string }>("thread_create", task);
    yield* answer(manager.id, requestId, { _tag: "question", text: "Wait for the children" });
    yield* events.until(isTag("turn.finished"));
    expect((yield* markDone(manager.id)).status).toBe(409);
    expect((yield* getThread(manager.id)).thread.doneAt).toBeNull();
    expect((yield* getThread(first.threadId)).thread.doneAt).toBeNull();
    expect((yield* getThread(second.threadId)).thread.doneAt).toBeNull();

    expect((yield* interrupt(manager.id)).status).toBe(200);
    expect((yield* markDone(first.threadId)).status).toBe(200);
    const firstDoneAt = (yield* getThread(first.threadId)).thread.doneAt;
    yield* TestClock.adjust(1);
    expect((yield* markDone(manager.id)).status).toBe(200);
    const managerDoneAt = (yield* getThread(manager.id)).thread.doneAt;
    expect(managerDoneAt).not.toBeNull();
    expect((yield* getThread(first.threadId)).thread.doneAt).toBe(firstDoneAt);
    expect((yield* getThread(second.threadId)).thread.doneAt).toBe(managerDoneAt);
    expect((yield* reopen(manager.id)).status).toBe(200);
    expect((yield* getThread(second.threadId)).thread.doneAt).toBe(managerDoneAt);
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
      prompt: {
        title: "Start child thread", detail: expect.stringContaining(task.prompt),
        childWorker: { providerInstanceId: "replay", model: null, modelSource: "provider-default" },
      },
    });
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "deny" });
    expect((yield* Fiber.join(pending)).isError).toBe(true);
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
  }));
});

const models = [
  { id: "agent-model", name: "Agent model", free: true, images: false },
  { id: "explicit-model", name: "Explicit model", free: true, images: false },
];
const workerProvider = {
  ...ReplayAdapter,
  kind: "worker-provider",
  capabilities: { ...ReplayAdapter.capabilities, models: true },
  listModels: () => Effect.succeed({ models, defaultModel: "explicit-model" }),
};

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, workerProvider])) }))("child worker selection", (it) => {
  const worker = {
    name: "Worker", description: "Reviews plans.", provider: "worker-provider", model: "agent-model",
    sources: [], mcp: [], autonomy: DEFAULT_AUTONOMY, instructions: "Review the plan.",
  };

  it.effect("discovers and launches a worker on another provider with its default or an explicit model", () => Effect.gen(function* () {
    yield* putAgent("worker", worker);
    const { mcp, manager, agentId } = yield* setup("allow", undefined, { workers: ["worker"], provider: "worker-provider", model: "agent-model" });
    const discovery = yield* mcp.result<{ workers: Array<{ agentId: string }> }>("thread_workers");
    expect(discovery.workers.map(({ agentId }) => agentId).sort()).toEqual([agentId, "worker"].sort());
    expect(discovery.workers).toContainEqual(expect.objectContaining({ agentId: "worker", description: worker.description, providerInstanceId: manager.providerInstanceId, model: null }));
    expect(yield* mcp.result("thread_worker_models", { agentId: "worker", providerInstanceId: "worker-provider" })).toMatchObject({
      providerInstanceId: "worker-provider", agentDefault: "agent-model", defaultModel: "explicit-model", models,
    });
    expect((yield* mcp.call("thread_create", { ...task, agentId: "researcher" })).content[0]?.text).toContain("worker allowlist");
    expect((yield* mcp.call("thread_worker_models", { agentId: "researcher" })).isError).toBe(true);
    expect((yield* mcp.call("thread_create", { ...task, agentId: "worker", providerInstanceId: "worker-provider", model: "missing" })).content[0]?.text).toContain("Use thread_worker_models");
    expect((yield* mcp.call("thread_create", { ...task, providerInstanceId: "missing" })).content[0]?.text).toContain("Use thread_workers");
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });

    const inherited = yield* mcp.result("thread_create", { ...task, agentId });
    expect(inherited).toMatchObject({ agentId, providerInstanceId: manager.providerInstanceId, model: null, modelSource: "provider-default" });
    const selected = yield* mcp.result("thread_create", { ...task, agentId: "worker", providerInstanceId: "worker-provider" });
    expect(selected).toMatchObject({ agentId: "worker", providerInstanceId: "worker-provider", model: "agent-model", modelSource: "agent-default" });
    const explicit = yield* mcp.result("thread_create", { ...task, agentId: "worker", providerInstanceId: "worker-provider", model: "explicit-model" });
    expect(explicit).toMatchObject({ agentId: "worker", providerInstanceId: "worker-provider", model: "explicit-model", modelSource: "explicit" });
    const override = yield* mcp.result("thread_create", { ...task, agentId: "worker" });
    expect(override).toMatchObject({ agentId: "worker", providerInstanceId: "replay", model: null, modelSource: "provider-default" });
    expect(yield* mcp.result("thread_list")).toMatchObject({ children: expect.arrayContaining([
      expect.objectContaining({ threadId: selected.threadId, model: "agent-model", modelSource: "agent-default" }),
      expect.objectContaining({ threadId: explicit.threadId, model: "explicit-model", modelSource: "explicit" }),
    ]) });
  }));

  it.effect("inherits the manager's model and honours a model override on the same provider", () => Effect.gen(function* () {
    const { mcp, manager, agentId } = yield* setup("allow", undefined, {
      workers: [], provider: "worker-provider", model: "agent-model", threadProvider: "worker-provider", threadModel: "explicit-model",
    });
    expect(manager.model).toBe("explicit-model");
    expect(yield* mcp.result("thread_create", task)).toMatchObject({
      agentId, providerInstanceId: "worker-provider", model: "explicit-model", modelSource: "inherited",
    });
    expect(yield* mcp.result("thread_create", { ...task, model: "agent-model" })).toMatchObject({
      agentId, providerInstanceId: "worker-provider", model: "agent-model", modelSource: "explicit",
    });
  }));

  it.effect("preserves unrestricted legacy launches and rechecks the allowlist after approval", () => Effect.gen(function* () {
    const legacy = yield* setup("allow");
    expect(yield* legacy.mcp.result("thread_create", { ...task, agentId: "researcher" })).toMatchObject({ agentId: "researcher" });

    const { manager, mcp, events, agentId, agent, hash } = yield* setup("ask", undefined, { workers: ["researcher"] });
    const pending = yield* Effect.forkChild(mcp.call("thread_create", { ...task, agentId: "researcher", providerInstanceId: "worker-provider", model: "explicit-model" }));
    const seen = yield* events.until(isTag("request.opened"));
    expect(seen.find(isTag("request.opened"))).toMatchObject({
      prompt: { childWorker: { agentId: "researcher", providerInstanceId: "worker-provider", model: "explicit-model", modelSource: "explicit" } },
    });
    yield* putAgent(agentId, { ...agent, workers: [] }, hash);
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "approve" });
    expect((yield* Fiber.join(pending)).content[0]?.text).toContain("worker allowlist");
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
  }));

  for (const permission of ["ask", "allow"] as const) {
    it.effect(`preserves unattended launch behavior with ${permission} autonomy`, () => Effect.gen(function* () {
      const { manager, mcp, events } = yield* setup(permission, undefined, { workers: [], unattended: true });
      yield* (yield* ThreadActors).sendMessage(manager.id, "managerfixture", [], { unattended: true });
      const seen = yield* events.until(isTag(permission === "ask" ? "notice" : "tool.finished"));
      if (permission === "ask") {
        expect(seen).toContainEqual(expect.objectContaining({ _tag: "notice", text: expect.stringContaining("Nobody was watching") }));
        expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
      } else {
        const { children } = yield* mcp.result<{ children: ReadonlyArray<{ threadId: string }> }>("thread_list");
        expect(children).toHaveLength(1);
        const { events: childEvents } = yield* getThread(children[0]!.threadId);
        expect(childEvents[0]?.event).toMatchObject({ _tag: "user.message", unattended: true });
      }
    }));
  }
});

const missingBinary = {
  ...workerProvider,
  kind: "missing-binary",
  status: Effect.succeed({ _tag: "unavailable", reason: "Worker CLI isn't installed. Install the Worker CLI." } as const),
  listModels: () => Effect.die(new Error("Unavailable providers must skip model discovery")),
};
let signedIn = false;
const signInProvider = {
  ...workerProvider,
  kind: "sign-in-required",
  status: Effect.sync(() => signedIn
    ? { _tag: "ready", account: null, version: null } as const
    : { _tag: "unavailable", reason: "Run worker login to sign in." } as const),
  listModels: missingBinary.listModels,
};

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, missingBinary, signInProvider])) }))("worker provider readiness", (it) => {
  it.effect("reports unavailable providers and refuses child launches without changing ordinary thread creation", () => Effect.gen(function* () {
    const { manager, vault, mcp, events, agentId } = yield* setup("ask", undefined, { provider: "missing-binary" });
    yield* putAgent("offline-worker", {
      name: "Offline worker", description: "", provider: "missing-binary", model: null, sources: [], mcp: [],
      autonomy: DEFAULT_AUTONOMY, instructions: "Test unavailable provider selection.",
    });
    expect(yield* mcp.result("thread_workers")).toMatchObject({
      providers: expect.arrayContaining([
        expect.objectContaining({ providerInstanceId: "replay", status: { _tag: "ready" } }),
        expect.objectContaining({ providerInstanceId: "missing-binary", status: { _tag: "unavailable", reason: expect.stringContaining("Install") } }),
        expect.objectContaining({ providerInstanceId: "sign-in-required", status: { _tag: "unavailable", reason: expect.stringContaining("worker login") } }),
      ]),
      workers: expect.arrayContaining([
        expect.objectContaining({ agentId, providerInstanceId: "replay", status: { _tag: "ready" } }),
        expect.objectContaining({ agentId: "offline-worker", providerInstanceId: "replay", providerConfigured: true, status: { _tag: "ready" } }),
      ]),
    });
    expect(yield* mcp.result("thread_worker_models", { providerInstanceId: "missing-binary" })).toMatchObject({
      status: { _tag: "unavailable", reason: expect.stringContaining("Install") }, models: [], defaultModel: null,
    });
    expect((yield* mcp.call("thread_create", { ...task, agentId: "offline-worker", providerInstanceId: "missing-binary" })).content[0]?.text).toContain("Install the Worker CLI");
    expect((yield* mcp.call("thread_create", {
      ...task, providerInstanceId: "missing-binary", model: "explicit-model",
    })).content[0]?.text).toContain("Install the Worker CLI");
    expect((yield* mcp.call("thread_create", { ...task, providerInstanceId: "sign-in-required" })).content[0]?.text).toContain("worker login");
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
    expect((yield* newThread(vault.id, "missing-binary")).providerInstanceId).toBe("missing-binary");

    signedIn = true;
    const pending = yield* Effect.forkChild(mcp.call("thread_create", { ...task, providerInstanceId: "sign-in-required" }));
    const seen = yield* events.until(isTag("request.opened"));
    expect(seen.find(isTag("request.opened"))).toMatchObject({
      prompt: { childWorker: { providerInstanceId: "sign-in-required", modelSource: "provider-default" } },
    });
    signedIn = false;
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "approve" });
    expect((yield* Fiber.join(pending)).content[0]?.text).toContain("worker login");
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
  }));
});

const revocationProbeStarted = Deferred.makeUnsafe<void>();
const resumeRevocationProbe = Deferred.makeUnsafe<void>();
let revocationModelListings = 0;
const revocationProvider = {
  ...workerProvider,
  listModels: () => Effect.gen(function* () {
    if (++revocationModelListings === 2) {
      yield* Deferred.succeed(revocationProbeStarted, undefined);
      yield* Deferred.await(resumeRevocationProbe);
    }
    return { models, defaultModel: "explicit-model" };
  }),
};

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, revocationProvider])) }))("child launch revocation", (it) => {
  it.effect("rejects a worker revoked while post-approval model validation is pending", () => Effect.gen(function* () {
    const { manager, mcp, events, agentId, agent, hash } = yield* setup("ask", undefined, { workers: ["researcher"] });
    const pending = yield* Effect.forkChild(mcp.call("thread_create", {
      ...task, agentId: "researcher", providerInstanceId: "worker-provider", model: "explicit-model",
    }));
    const seen = yield* events.until(isTag("request.opened"));
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "approve" });
    yield* Deferred.await(revocationProbeStarted);
    yield* putAgent(agentId, { ...agent, workers: [] }, hash);
    yield* Deferred.succeed(resumeRevocationProbe, undefined);
    const result = yield* Fiber.join(pending);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("worker allowlist");
    expect(yield* mcp.result("thread_list")).toEqual({ children: [] });
  }).pipe(Effect.ensuring(Deferred.succeed(resumeRevocationProbe, undefined))));
});

const validationStarted = Deferred.makeUnsafe<void>();
const releaseValidation = Deferred.makeUnsafe<void>();
const dispatchStarted = Deferred.makeUnsafe<void>();
const releaseDispatch = Deferred.makeUnsafe<void>();
let modelListings = 0;
const slowWorkerProvider = {
  ...workerProvider,
  listModels: () => Effect.gen(function* () {
    if (++modelListings === 2) {
      yield* Deferred.succeed(validationStarted, undefined);
      yield* Deferred.await(releaseValidation);
    }
    return { models, defaultModel: "explicit-model" };
  }),
  openSession: (input: Parameters<typeof ReplayAdapter.openSession>[0]) => Effect.gen(function* () {
    yield* Deferred.succeed(dispatchStarted, undefined);
    yield* Deferred.await(releaseDispatch);
    return yield* ReplayAdapter.openSession(input);
  }),
};

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, slowWorkerProvider])) }))("child launch concurrency", (it) => {
  it.effect("interrupts unrelated threads during post-approval model validation and dispatch", () => Effect.gen(function* () {
    const { manager, vault, mcp, events } = yield* setup("ask");
    const { manager: unrelated } = yield* setup("allow", vault);
    const { manager: other } = yield* setup("allow", vault);
    const pending = yield* Effect.forkChild(mcp.call("thread_create", {
      ...task, providerInstanceId: "worker-provider", model: "explicit-model",
    }));
    const seen = yield* events.until(isTag("request.opened"));
    yield* answer(manager.id, requestIdOf(seen), { _tag: "approval", decision: "approve" });
    yield* Deferred.await(validationStarted);
    const stopped = yield* TestClock.withLive(interrupt(unrelated.id).pipe(Effect.timeoutOption("2 seconds"))).pipe(
      Effect.ensuring(Deferred.succeed(releaseValidation, undefined)),
    );
    expect(Option.getOrUndefined(stopped)?.status).toBe(200);
    yield* Deferred.await(dispatchStarted);
    const stoppedDuringDispatch = yield* TestClock.withLive(interrupt(other.id).pipe(Effect.timeoutOption("2 seconds"))).pipe(
      Effect.ensuring(Deferred.succeed(releaseDispatch, undefined)),
    );
    expect(Option.getOrUndefined(stoppedDuringDispatch)?.status).toBe(200);
    expect((yield* Fiber.join(pending)).isError).toBe(false);
  }));
});

for (const target of ["child", "manager"] as const) {
  const opening = Deferred.makeUnsafe<void>();
  const release = Deferred.makeUnsafe<void>();
  const stalledProvider = {
    ...workerProvider,
    openSession: (input: Parameters<typeof ReplayAdapter.openSession>[0]) => Effect.gen(function* () {
      yield* Deferred.succeed(opening, undefined);
      yield* Deferred.await(release);
      return yield* ReplayAdapter.openSession(input);
    }),
  };

  layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, stalledProvider])) }))(`stopping a stalled ${target} family`, (it) => {
    it.effect("leaves unrelated Stop responsive before provider startup resumes", () => Effect.gen(function* () {
      const { manager, vault, mcp } = yield* setup("allow");
      const { manager: unrelated } = yield* setup("allow", vault);
      const launch = yield* Effect.forkChild(mcp.call("thread_create", { ...task, providerInstanceId: "worker-provider" }));
      yield* Deferred.await(opening);
      const { children } = yield* mcp.result<{ children: ReadonlyArray<{ threadId: string }> }>("thread_list");
      const childId = children[0]!.threadId;
      const actors = yield* ThreadActors;
      const stopped = yield* Effect.forkChild(actors.interrupt(target === "child" ? childId : manager.id), { startImmediately: true });

      const unrelatedStop = yield* TestClock.withLive(interrupt(unrelated.id).pipe(Effect.timeoutOption("2 seconds")));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(stopped);
      expect(Option.getOrUndefined(unrelatedStop)?.status).toBe(200);
      expect((yield* Fiber.join(launch)).isError).toBe(false);
      expect((yield* getThread(childId)).thread.lastTurn?.outcome).toBe("interrupted");
      if (target === "manager") expect((yield* getThread(manager.id)).thread.lastTurn?.outcome).toBe("interrupted");
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))));
  });
}

const cancelledStopDispatchStarted = Deferred.makeUnsafe<void>();
const resumeCancelledStopDispatch = Deferred.makeUnsafe<void>();
const approvedLaunchValidationStarted = Deferred.makeUnsafe<void>();
const resumeApprovedLaunchValidation = Deferred.makeUnsafe<void>();
const stopReachedChild = Deferred.makeUnsafe<void>();
let cancelledStopModelListings = 0;
const cancellationProvider = {
  ...workerProvider,
  listModels: () => Effect.gen(function* () {
    if (++cancelledStopModelListings === 2) {
      yield* Deferred.succeed(approvedLaunchValidationStarted, undefined);
      yield* Deferred.await(resumeApprovedLaunchValidation);
    }
    return { models, defaultModel: "explicit-model" };
  }),
  openSession: (input: Parameters<typeof ReplayAdapter.openSession>[0]) => Effect.gen(function* () {
    if (input.model === null) {
      yield* Deferred.succeed(cancelledStopDispatchStarted, undefined);
      yield* Deferred.await(resumeCancelledStopDispatch);
    }
    return yield* ReplayAdapter.openSession(input);
  }),
};
const stopWitnessProvider = {
  ...ReplayAdapter,
  kind: "stop-witness",
  openSession: (input: Parameters<typeof ReplayAdapter.openSession>[0]) => ReplayAdapter.openSession(input).pipe(
    Effect.map((session) => ({
      ...session,
      interrupt: (turnId: string) => Effect.andThen(Deferred.succeed(stopReachedChild, undefined), session.interrupt(turnId)),
    })),
  ),
};

layer(makeTestApp({ providers: makeProviderRegistry(Effect.succeed([ReplayAdapter, cancellationProvider, stopWitnessProvider])) }))("cancelled manager Stop", (it) => {
  it.effect("keeps an approved launch serialized after the Stop caller cancels", () => Effect.gen(function* () {
    const { manager, vault, mcp, events } = yield* setup("ask");
    const { manager: unrelated } = yield* setup("allow", vault);
    const approveLaunch = Effect.fnUntraced(function* (providerInstanceId: string, model?: string) {
      const launched = yield* Effect.forkChild(mcp.call("thread_create", { ...task, providerInstanceId, ...(model === undefined ? {} : { model }) }));
      const approval = yield* events.until(isTag("request.opened"));
      expect((yield* answer(manager.id, requestIdOf(approval), { _tag: "approval", decision: "approve" })).status).toBe(200);
      return launched;
    });

    const witness = yield* approveLaunch("stop-witness");
    expect((yield* Fiber.join(witness)).isError).toBe(false);
    yield* approveLaunch("worker-provider");
    yield* Deferred.await(cancelledStopDispatchStarted);
    const approved = yield* approveLaunch("worker-provider", "explicit-model");
    yield* Deferred.await(approvedLaunchValidationStarted);

    const actors = yield* ThreadActors;
    const stop = yield* Effect.forkChild(actors.interrupt(manager.id));
    yield* Deferred.await(stopReachedChild);
    const cancelled = yield* Effect.forkChild(Fiber.interrupt(stop), { startImmediately: true });
    const waitingStop = yield* Effect.forkChild(actors.interrupt(manager.id), { startImmediately: true });
    const cancelledWait = yield* Effect.forkChild(Fiber.interrupt(waitingStop), { startImmediately: true });
    const waitingCaller = yield* TestClock.withLive(Fiber.await(cancelledWait).pipe(Effect.timeoutOption("2 seconds")));
    expect(Option.isSome(waitingCaller)).toBe(true);
    yield* Deferred.succeed(resumeApprovedLaunchValidation, undefined);

    const unrelatedStop = yield* TestClock.withLive(interrupt(unrelated.id).pipe(Effect.timeoutOption("2 seconds")));
    expect(Option.getOrUndefined(unrelatedStop)?.status).toBe(200);
    const prematureLaunch = yield* TestClock.withLive(Fiber.await(approved).pipe(Effect.timeoutOption("2 seconds")));
    yield* Deferred.succeed(resumeCancelledStopDispatch, undefined);
    yield* Fiber.join(cancelled);
    expect(Option.isNone(prematureLaunch)).toBe(true);
    expect((yield* Fiber.join(approved)).isError).toBe(true);
    const { children } = yield* mcp.result<{ children: ReadonlyArray<{ threadId: string }> }>("thread_list");
    expect(children).toHaveLength(2);
    for (const child of children) expect((yield* getThread(child.threadId)).thread.lastTurn?.outcome).toBe("interrupted");
  }).pipe(Effect.ensuring(Effect.all([
    Deferred.succeed(resumeCancelledStopDispatch, undefined),
    Deferred.succeed(resumeApprovedLaunchValidation, undefined),
  ]))));
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
