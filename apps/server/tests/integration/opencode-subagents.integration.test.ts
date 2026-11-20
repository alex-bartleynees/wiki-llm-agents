/**
 * OpenCode 2.3's background subagents through the real HTTP app, played from
 * recordings (`subagents`, `subagents-stop`; see `scripts/record-opencode.ts`):
 * subagents shown in the thread, their requests routed back to them, the turns
 * their reports start, Stop stopping everything, and a restart under them.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { InterruptTurnResponse } from "@wiki-agents/contracts/threads/interrupt-turn/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Context, Effect, Layer, PubSub, type Scope } from "effect";
import { makeHttpApp } from "../../src/app/layers.js";
import { makeOpenCodeAdapter } from "../../src/features/providers/opencode/adapter.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { type FakeOpenCode, loadFixture, makeFakeOpenCode } from "../fixtures/opencode/fake-api.js";
import { VAULT_FILES } from "../fixtures/opencode/fixture.js";
import { answer, decode, getThread, interrupt, newThread, newVaultWith, sendOk } from "./infrastructure/threads.js";
import { makeTestApp, TestAgents, TestAttachments, TestSecrets, TestWorktrees } from "./infrastructure/test-app.js";

class Fake extends Context.Service<Fake, FakeOpenCode>()("FakeOpenCode") {}

const providersOver = (fake: Layer.Layer<Fake>) =>
  makeProviderRegistry(
    Effect.gen(function* () {
      const fake = yield* Fake;
      const opencode = yield* makeOpenCodeAdapter({ start: fake.start, installedVersion: Effect.succeed("2.3.0") });
      return [opencode, ReplayAdapter];
    }),
  ).pipe(Layer.provide(fake));

const FakeLive = Layer.effect(Fake, makeFakeOpenCode);
const App = Layer.merge(makeTestApp({ providers: providersOver(FakeLive) }), FakeLive);

/** Subscribes to the thread's events now; `until` collects them up to the first one matching `done`. */
const watch = (threadId: string) =>
  Effect.gen(function* () {
    const subscription = yield* (yield* ThreadBus).subscribeEvents;
    const seen: Array<ThreadEvent> = [];
    const until = (done: (event: ThreadEvent) => boolean) =>
      Effect.gen(function* () {
        while (true) {
          const stored = yield* PubSub.take(subscription);
          if (stored.threadId !== threadId) continue;
          seen.push(stored.event);
          if (done(stored.event)) return seen;
        }
      });
    return { until, seen };
  });

type Updated = Extract<ThreadEvent, { readonly _tag: "subagent.updated" }>;
const updates = (events: ReadonlyArray<ThreadEvent>) => events.filter((event): event is Updated => event._tag === "subagent.updated");
/** Each subagent's latest state, by id. */
const latest = (events: ReadonlyArray<ThreadEvent>) => new Map(updates(events).map((event) => [event.subagentId, event]));

/** Both subagents have been seen running, and the agent's own turn `turnId` has ended (they arrive on separate fibers, in either order). */
const launchedBoth = (events: Effect.Success<ReturnType<typeof watch>>, turnId: string) =>
  events.until(() => latest(events.seen).size === 2 && events.seen.some((event) => event._tag === "turn.finished" && event.turnId === turnId));

const opened = (event: ThreadEvent): event is Extract<ThreadEvent, { readonly _tag: "request.opened" }> => event._tag === "request.opened";

/** Approves the agent's two launches of a subagent (OpenCode asks on the agent's own session). */
const approveLaunches = (threadId: string, events: Effect.Success<ReturnType<typeof watch>>) =>
  Effect.gen(function* () {
    for (let launch = 0; launch < 2; launch++) {
      const request = (yield* events.until((event) => opened(event) && event.subagentId === undefined)).at(-1);
      if (request === undefined || !opened(request)) throw new Error("no launch to approve");
      expect(request.prompt).toMatchObject({ _tag: "approval", title: "Use subagent on general" });
      expect((yield* answer(threadId, request.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
    }
  });

const setUp = (scenario: string) =>
  Effect.gen(function* () {
    const vault = yield* newVaultWith(VAULT_FILES);
    const fixture = loadFixture(scenario);
    const fake = yield* Fake;
    yield* fake.load(fixture, vault.rootPath);
    const thread = yield* newThread(vault.id, "opencode");
    return { thread, fake, prompt: fixture.turns[0]!.prompt };
  });

layer(App)("OpenCode subagents", (it) => {
  it.effect("shows two subagents, sends one's approval back to it, and records the turn their reports start", () =>
    Effect.gen(function* () {
      const { thread, fake, prompt } = yield* setUp("subagents");
      const events = yield* watch(thread.id);
      const launched = yield* sendOk(thread.id, prompt);
      yield* approveLaunches(thread.id, events);

      // The agent's own turn ends while its subagents work.
      yield* launchedBoth(events, launched);
      const running = latest(events.seen);
      expect([...running.values()].map((subagent) => subagent.label).sort()).toEqual(["Append Oolong too. to Tea.md", "Report first line of Coffee.md"]);
      for (const subagent of running.values()) expect(subagent).toMatchObject({ turnId: launched, agent: "general" });

      // One subagent's report wakes the agent: a turn nobody sent, under the divider.
      const reported = (yield* events.until((event) => event._tag === "subagent.reported")).at(-1);
      if (reported?._tag !== "subagent.reported") throw new Error("no report");
      expect(reported.reports).toEqual([expect.objectContaining({ label: "Report first line of Coffee.md", status: "done" })]);
      expect(reported.turnId).not.toBe(launched);

      // The other asks to edit: its request belongs to the turn that launched it, and goes back to it.
      const asked = (yield* events.until((event) => opened(event) && event.subagentId !== undefined)).at(-1);
      if (asked === undefined || !opened(asked)) throw new Error("the subagent didn't ask");
      expect(asked).toMatchObject({ turnId: launched, prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      expect((yield* getThread(thread.id)).thread).toMatchObject({ status: "waiting", subagentsActive: 1 });
      expect((yield* answer(thread.id, asked.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);

      yield* events.until((event) => event._tag === "turn.finished" && event.turnId === reported.turnId);
      yield* fake.played;
      const { thread: summary, events: stored } = yield* getThread(thread.id);
      expect(summary).toMatchObject({ status: "idle", subagentsActive: 0 });
      const done = latest(stored.map((item) => item.event));
      expect([...done.values()].map((subagent) => subagent.status)).toEqual(["done", "done"]);
      expect(done.get(asked.subagentId!)?.result).toContain("Oolong");
      expect(fake.calls).toContainEqual({ call: "reply", requestId: asked.requestId, reply: "once" });
      // The answered request stays answered: the turns that ended around it didn't cancel it.
      expect(stored.map((item) => item.event)).toContainEqual({ _tag: "request.resolved", turnId: launched, requestId: asked.requestId, answer: { _tag: "approval", decision: "approve" } });
    }),
  );

  it.effect("Stop with only subagents running stops every one, and nothing wakes the agent", () =>
    Effect.gen(function* () {
      const { thread, fake, prompt } = yield* setUp("subagents-stop");
      const events = yield* watch(thread.id);
      const launched = yield* sendOk(thread.id, prompt);
      yield* approveLaunches(thread.id, events);
      yield* launchedBoth(events, launched);
      expect((yield* getThread(thread.id)).thread).toMatchObject({ status: "idle", subagentsActive: 2 });

      const stopped = yield* interrupt(thread.id).pipe(Effect.flatMap(decode(InterruptTurnResponse)));
      expect(stopped.turnId).toBeNull();
      yield* fake.played;
      yield* events.until(() => [...latest(events.seen).values()].every((subagent) => subagent.status === "cancelled"));
      // Both subagents, then the agent their reports woke: stopped at once, not handed to the app as a turn.
      yield* fake.made("interrupt", 3);

      const { thread: summary, events: stored } = yield* getThread(thread.id);
      expect(summary).toMatchObject({ status: "idle", subagentsActive: 0 });
      // The agent was never woken: no turn after the one that launched them.
      expect(stored.filter((item) => item.event._tag === "turn.started").map((item) => item.event.turnId)).toEqual([launched]);
      expect(stored.some((item) => item.event._tag === "subagent.reported")).toBe(false);
      // Both reports withdrawn, both subagents and the woken agent stopped.
      expect(fake.calls.filter((call) => call.call === "cancelPrompt")).toHaveLength(2);
      expect(fake.calls.filter((call) => call.call === "interrupt").length).toBeGreaterThanOrEqual(3);
      // With nothing running, Stop has nothing to do.
      expect((yield* interrupt(thread.id)).status).toBe(409);
    }),
  );
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** The app over a database file and an OpenCode that outlives it. */
const appOn = (file: string, fake: FakeOpenCode) =>
  makeHttpApp({ vaults: [], watch: false, providers: providersOver(Layer.succeed(Fake, fake)), agents: TestAgents, attachments: TestAttachments, worktrees: TestWorktrees, secrets: TestSecrets }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

describe("OpenCode subagents across a restart", () => {
  it.effect("marks subagents the restart cut off as interrupted, keeping what they had reported", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-subagents-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );
      const file = join(dir, "app.db");
      const fake = yield* makeFakeOpenCode;
      const run = <A, E>(body: Effect.Effect<A, E, Layer.Success<ReturnType<typeof appOn>> | Scope.Scope>) => Effect.scoped(Effect.provide(body, appOn(file, fake)));

      const { threadId, launched } = yield* run(
        Effect.gen(function* () {
          const vault = yield* newVaultWith(VAULT_FILES);
          const fixture = loadFixture("subagents-stop");
          yield* fake.load(fixture, vault.rootPath);
          const thread = yield* newThread(vault.id, "opencode");
          const events = yield* watch(thread.id);
          const launched = yield* sendOk(thread.id, fixture.turns[0]!.prompt);
          yield* approveLaunches(thread.id, events);
          yield* launchedBoth(events, launched);
          return { threadId: thread.id, launched };
        }),
      );

      // The server stopped with both subagents running; OpenCode's session went with it.
      // The next start wakes the thread in the background: wait for it unless it's done.
      const after = yield* run(
        Effect.gen(function* () {
          const events = yield* watch(threadId);
          const interrupted = (items: ReadonlyArray<ThreadEvent>) => updates(items).filter((event) => event.status === "interrupted").length === 2;
          if (!interrupted((yield* getThread(threadId)).events.map((item) => item.event))) yield* events.until(() => interrupted(events.seen));
          return yield* getThread(threadId);
        }),
      );
      expect(after.thread).toMatchObject({ status: "idle", subagentsActive: 0 });
      const closed = latest(after.events.map((item) => item.event));
      expect([...closed.values()].map((subagent) => [subagent.turnId, subagent.status])).toEqual([
        [launched, "interrupted"],
        [launched, "interrupted"],
      ]);
    }),
  );
});
