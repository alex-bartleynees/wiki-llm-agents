/**
 * Claude Code's background subagents (the `Agent` tool, in the background by default
 * since 2.1.32x) through the real HTTP app, played from recordings (`subagents`,
 * `subagents-stop`, `subagents-stop-running`; see `scripts/record-claude-code.ts`):
 * subagents shown in the thread, a subagent's approval routed back to it, the turns
 * their reports start, Stop stopping everything, and Claude Code exiting under them.
 */
import { expect, layer } from "@effect/vitest";
import { type AgentInput, DEFAULT_AUTONOMY } from "@wiki-agents/contracts/agents/model";
import { InterruptTurnResponse } from "@wiki-agents/contracts/threads/interrupt-turn/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { Context, Effect, Layer, PubSub } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { CLAUDE_STOPPED, makeClaudeCodeAdapter } from "../../src/features/providers/claude-code/adapter.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { type FakeSdk, loadFixture, makeFakeSdk, type PlayOptions } from "../fixtures/claude-code/fake-sdk.js";
import { VAULT_FILES } from "../fixtures/claude-code/fixture.js";
import { answer, decode, getThread, interrupt, newThread, newVaultWith, sendOk, setAgent } from "./infrastructure/threads.js";
import { makeTestApp } from "./infrastructure/test-app.js";

class Fake extends Context.Service<Fake, FakeSdk>()("FakeClaudeCode") {}

const FakeLive = Layer.sync(Fake, makeFakeSdk);

const providers = makeProviderRegistry(
  Effect.gen(function* () {
    const fake = yield* Fake;
    const claude = yield* makeClaudeCodeAdapter({
      sdk: fake.sdk,
      // Something executable, so the adapter finds "claude"; the fake never runs it.
      binary: process.execPath,
      installedVersion: () => Effect.succeed("2.1.325"),
      authStatus: () => Effect.succeed({ loggedIn: true, account: "you@example.com (pro)" }),
    });
    return [claude, ReplayAdapter];
  }),
).pipe(Layer.provide(FakeLive));

const App = Layer.merge(makeTestApp({ providers }), FakeLive);

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

const opened = (event: ThreadEvent): event is Extract<ThreadEvent, { readonly _tag: "request.opened" }> => event._tag === "request.opened";
const finished = (turnId: string) => (event: ThreadEvent) => event._tag === "turn.finished" && event.turnId === turnId;

/** The agent's subagents start without asking and may run commands, as the Stop recordings were made. */
const useDelegator = (threadId: string) =>
  Effect.gen(function* () {
    const agent: AgentInput = {
      name: "Delegator", description: "", provider: null, model: null, sources: [], mcp: [],
      autonomy: { ...DEFAULT_AUTONOMY, commands: "allow", subagents: "allow" },
      instructions: "Delegate.",
    };
    // The tests share one app: an agent of their own each.
    const id = `delegator-${threadId.slice(0, 8)}`;
    yield* HttpClient.execute(HttpClientRequest.put(`/api/agents/${id}`).pipe(HttpClientRequest.bodyJsonUnsafe({ agent, baseHash: null }))).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
    );
    yield* setAgent(threadId, id);
  });

const setUp = (scenario: string, options?: PlayOptions) =>
  Effect.gen(function* () {
    const vault = yield* newVaultWith(VAULT_FILES);
    const fixture = loadFixture(scenario);
    const fake = yield* Fake;
    fake.load(fixture, vault.rootPath, options);
    const thread = yield* newThread(vault.id, "claude-code");
    return { thread, fake, prompt: fixture.turns[0]!.prompt };
  });

layer(App)("Claude Code subagents", (it) => {
  it.effect("shows two background subagents, sends one's approval back to it, and records the turns their reports start", () =>
    Effect.gen(function* () {
      const { thread, fake, prompt } = yield* setUp("subagents");
      const events = yield* watch(thread.id);
      const launched = yield* sendOk(thread.id, prompt);

      // Starting a subagent asks (the default autonomy): the agent's own requests, in its turn.
      for (let launch = 0; launch < 2; launch++) {
        const request = (yield* events.until((event) => opened(event) && event.subagentId === undefined)).at(-1);
        if (request === undefined || !opened(request)) throw new Error("no launch to approve");
        expect(request).toMatchObject({ turnId: launched, prompt: { _tag: "approval", title: expect.stringMatching(/^Start a subagent: /) } });
        expect((yield* answer(thread.id, request.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
      }

      // The agent's turn ends while both work; their own tool calls aren't in it.
      yield* events.until(() => latest(events.seen).size === 2 && events.seen.some(finished(launched)));
      const running = latest(events.seen);
      expect([...running.values()].map((subagent) => subagent.label).sort()).toEqual(["Append line to Tea.md", "Report first line of Coffee.md"]);
      for (const subagent of running.values()) expect(subagent).toMatchObject({ turnId: launched, agent: "general-purpose" });
      expect(events.seen.filter((event) => event._tag === "tool.called").map((event) => event._tag === "tool.called" && event.name)).toEqual(["Agent", "Agent"]);

      // The Coffee subagent's report wakes the agent: a turn nobody sent, under the divider.
      const first = (yield* events.until((event) => event._tag === "subagent.reported")).at(-1);
      if (first?._tag !== "subagent.reported") throw new Error("no report");
      expect(first.reports).toEqual([expect.objectContaining({ label: "Report first line of Coffee.md", status: "done" })]);
      expect(first.turnId).not.toBe(launched);

      // The other asks to edit: its request belongs to the turn that launched it, and goes back to it.
      const asked = (yield* events.until((event) => opened(event) && event.subagentId !== undefined)).at(-1);
      if (asked === undefined || !opened(asked)) throw new Error("the subagent didn't ask");
      expect(asked).toMatchObject({ turnId: launched, prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      expect(latest(events.seen).get(asked.subagentId!)?.status).toBe("waiting");
      expect((yield* answer(thread.id, asked.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);

      // Its report starts a second turn.
      const second = (yield* events.until((event) => event._tag === "subagent.reported" && event.turnId !== first.turnId)).at(-1);
      if (second?._tag !== "subagent.reported") throw new Error("no second report");
      expect(second.reports).toEqual([expect.objectContaining({ subagentId: asked.subagentId, status: "done" })]);
      yield* events.until(finished(second.turnId));
      yield* fake.played;

      const { thread: summary, events: stored } = yield* getThread(thread.id);
      expect(summary).toMatchObject({ status: "idle", subagentsActive: 0 });
      const done = latest(stored.map((item) => item.event));
      expect([...done.values()].map((subagent) => subagent.status)).toEqual(["done", "done"]);
      expect(done.get(asked.subagentId!)?.result).toContain("Oolong");
      expect(fake.calls).toContainEqual({ call: "permission", toolName: "Edit", result: expect.objectContaining({ behavior: "allow" }) });
      // Three turns, each with its own reply: the launch, then one per report.
      const turns = stored.filter((item) => item.event._tag === "turn.started").map((item) => item.event.turnId);
      expect(turns).toEqual([launched, first.turnId, second.turnId]);
      for (const turnId of turns) expect(stored.map((item) => item.event)).toContainEqual(expect.objectContaining({ _tag: "turn.finished", turnId, outcome: "completed" }));
      // Claude Code was told to echo the app's messages, so a report's turn is told apart from the app's.
      expect(fake.queries()[0]?.extraArgs).toEqual({ "replay-user-messages": null });
    }),
  );

  it.effect("Stop with only subagents running stops them, and nothing wakes the agent", () =>
    Effect.gen(function* () {
      const { thread, fake, prompt } = yield* setUp("subagents-stop");
      yield* useDelegator(thread.id);
      const events = yield* watch(thread.id);
      const launched = yield* sendOk(thread.id, prompt);
      yield* events.until(() => latest(events.seen).size === 2 && events.seen.some(finished(launched)));
      expect((yield* getThread(thread.id)).thread).toMatchObject({ status: "idle", subagentsActive: 2 });

      const stopped = yield* interrupt(thread.id).pipe(Effect.flatMap(decode(InterruptTurnResponse)));
      expect(stopped.turnId).toBeNull();
      yield* events.until(() => [...latest(events.seen).values()].every((subagent) => subagent.status === "cancelled"));
      yield* fake.played;

      const { thread: summary, events: stored } = yield* getThread(thread.id);
      expect(summary).toMatchObject({ status: "idle", subagentsActive: 0 });
      // Claude Code's interrupt stopped them; the agent was never woken.
      expect(fake.calls.filter((call) => call.call === "interrupt")).toHaveLength(1);
      expect(stored.filter((item) => item.event._tag === "turn.started").map((item) => item.event.turnId)).toEqual([launched]);
      expect(stored.some((item) => item.event._tag === "subagent.reported")).toBe(false);
      expect((yield* interrupt(thread.id)).status).toBe(409);
    }),
  );

  it.effect("Stop while the turn that launched the subagents still runs stops it and every subagent", () =>
    Effect.gen(function* () {
      const { thread, fake, prompt } = yield* setUp("subagents-stop-running");
      yield* useDelegator(thread.id);
      const events = yield* watch(thread.id);
      const launched = yield* sendOk(thread.id, prompt);
      yield* events.until(() => latest(events.seen).size === 2);
      expect(events.seen.some(finished(launched))).toBe(false);
      expect((yield* getThread(thread.id)).thread).toMatchObject({ status: "running", subagentsActive: 2 });

      const stopped = yield* interrupt(thread.id).pipe(Effect.flatMap(decode(InterruptTurnResponse)));
      expect(stopped.turnId).toBe(launched);
      yield* events.until(() => [...latest(events.seen).values()].every((subagent) => subagent.status === "cancelled") && events.seen.some(finished(launched)));
      yield* fake.played;

      const { thread: summary, events: stored } = yield* getThread(thread.id);
      expect(summary).toMatchObject({ status: "idle", subagentsActive: 0 });
      expect(stored.map((item) => item.event)).toContainEqual(expect.objectContaining({ _tag: "turn.finished", turnId: launched, outcome: "interrupted" }));
      expect(stored.filter((item) => item.event._tag === "turn.started").map((item) => item.event.turnId)).toEqual([launched]);
      expect(stored.some((item) => item.event._tag === "subagent.reported")).toBe(false);
    }),
  );

  it.effect("Claude Code exiting with subagents running ends the turn and marks them interrupted", () =>
    Effect.gen(function* () {
      // The process exits once both subagents run, before the agent's turn ends.
      const { thread, fake, prompt } = yield* setUp("subagents-stop", { crashAfter: 50 });
      yield* useDelegator(thread.id);
      const events = yield* watch(thread.id);
      const launched = yield* sendOk(thread.id, prompt);
      yield* events.until(() => events.seen.some(finished(launched)) && updates(events.seen).filter((event) => event.status === "interrupted").length === 2);

      const { thread: summary, events: stored } = yield* getThread(thread.id);
      expect(summary).toMatchObject({ subagentsActive: 0 });
      expect(stored.map((item) => item.event)).toContainEqual(expect.objectContaining({ _tag: "turn.finished", turnId: launched, outcome: "failed", reason: expect.stringContaining(CLAUDE_STOPPED) }));
      expect([...latest(stored.map((item) => item.event)).values()].map((subagent) => [subagent.turnId, subagent.status])).toEqual([
        [launched, "interrupted"],
        [launched, "interrupted"],
      ]);
      expect(fake.calls.filter((call) => call.call === "query")).toHaveLength(1);
    }),
  );
});
