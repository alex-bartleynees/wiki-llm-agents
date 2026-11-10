import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { GetProviderStatusResponse } from "@wiki-agents/contracts/providers/get-provider-status/response";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Context, Effect, Fiber, Layer, PubSub, type Scope } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import { makeHttpApp } from "../../src/app/layers.js";
import { DENIED, makeOpenCodeAdapter, SESSION_PERMISSIONS } from "../../src/features/providers/opencode/adapter.js";
import { type OpenCodeApi, OpenCodeError } from "../../src/features/providers/opencode/api.js";
import { binaryVersion } from "../../src/features/providers/opencode/server.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { ReplayAdapter } from "../../src/features/providers/replay/adapter.js";
import { SERVER_STOPPED } from "../../src/features/threads/thread-actor.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { type FakeOpenCode, loadFixture, makeFakeOpenCode, type PlayOptions } from "../fixtures/opencode/fake-api.js";
import { VAULT_FILES } from "../fixtures/opencode/fixture.js";
import { makeTestApp } from "./infrastructure/test-app.js";
import {
  answer,
  decode,
  getThread,
  interrupt,
  isTag,
  newThread,
  newVaultWith,
  requestIdOf,
  sendOk,
  status,
  tags,
} from "./infrastructure/threads.js";

/** The fake OpenCode server the adapter talks to; tests load a recording into it. */
class Fake extends Context.Service<Fake, FakeOpenCode>()("FakeOpenCode") {}

/** OpenCode (over the fake) and replay, as in production. */
const providersOver = (fake: Layer.Layer<Fake>) =>
  makeProviderRegistry(
    Effect.gen(function* () {
      const { api } = yield* Fake;
      const opencode = yield* makeOpenCodeAdapter({ start: Effect.succeed(api), installedVersion: Effect.succeed("2.2.1") });
      return [opencode, ReplayAdapter];
    }),
  ).pipe(Layer.provide(fake));

const FakeLive = Layer.effect(Fake, makeFakeOpenCode);
const App = Layer.merge(makeTestApp({ providers: providersOver(FakeLive) }), FakeLive);

/** A vault with the recordings' notes, an OpenCode thread in it, and `scenario` loaded. */
const setUp = (scenario: string, options?: PlayOptions) =>
  Effect.gen(function* () {
    const vault = yield* newVaultWith(VAULT_FILES);
    const fixture = loadFixture(scenario);
    const fake = yield* Fake;
    yield* fake.load(fixture, vault.rootPath, options);
    const thread = yield* newThread(vault.id, "opencode");
    return { vault, thread, fixture, fake, prompts: fixture.turns.map((turn) => turn.prompt) };
  });

/**
 * Subscribes to the thread's events now; `until` collects them up to the first one
 * matching `done`. The fake plays without delays, so no clock is needed unless a
 * test is about silence.
 */
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

const textOf = (events: ReadonlyArray<ThreadEvent>) => events.flatMap((event) => (event._tag === "message.delta" ? [event.text] : [])).join("");

const finishedOf = (events: ReadonlyArray<ThreadEvent>) => {
  const last = events.at(-1);
  if (last?._tag !== "turn.finished") throw new Error(`the turn didn't finish: ${events.map((event) => event._tag).join(", ")}`);
  return last;
};

layer(App)("OpenCode provider", (it) => {
  it.effect("is listed first, as the default, and reports its version", () =>
    Effect.gen(function* () {
      const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
      expect(providers.map((provider) => provider.id)).toEqual(["opencode", "replay"]);
      expect(providers[0]?.capabilities).toEqual({ interrupt: true, resume: false, approvals: true, questions: true, models: true });
      const { status: ready } = yield* HttpClient.get("/api/providers/opencode/status").pipe(Effect.flatMap(decode(GetProviderStatusResponse)));
      expect(ready).toEqual({ _tag: "ready", version: "2.2.1" });
      expect((yield* HttpClient.get("/api/providers/nope/status")).status).toBe(404);
    }),
  );

  it.effect("streams a simple turn with its tool calls and usage", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("simple");
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, prompts[0]!);
      const seen = yield* events.until(isTag("turn.finished"));

      const finished = finishedOf(seen);
      expect(finished).toMatchObject({ turnId, outcome: "completed", reason: null });
      expect(finished.usage?.inputTokens).toBeGreaterThan(0);
      expect(finished.usage?.costUsd).toBe(0);
      const tools = seen.filter((event) => event._tag === "tool.called");
      expect(tools.length).toBeGreaterThan(0);
      // Paths are shown relative to the vault, never as the absolute temp folder.
      for (const tool of tools) expect(tool.input).not.toContain(tmpdir());
      expect(seen.filter((event) => event._tag === "tool.finished")).toHaveLength(tools.length);
      expect(textOf(seen)).toMatch(/Coffee|Tea|index/);
      // Everything asks first except reading; the catch-all comes first, as the last matching rule wins.
      expect(fake.calls[0]).toEqual({ call: "createSession", model: null, permissions: SESSION_PERMISSIONS });
      expect(SESSION_PERMISSIONS[0]).toEqual({ action: "*", resource: "*", effect: "ask" });
      expect(SESSION_PERMISSIONS.slice(1).map((rule) => rule.action)).not.toEqual(expect.arrayContaining(["edit"]));
      expect(SESSION_PERMISSIONS.filter((rule) => ["edit", "shell", "webfetch"].includes(rule.action))).toEqual([]);
      expect((yield* getThread(thread.id)).thread.status).toBe("idle");
    }),
  );

  it.effect("keeps one OpenCode session across turns", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      for (const prompt of prompts) {
        const events = yield* watch(thread.id);
        yield* sendOk(thread.id, prompt);
        expect(finishedOf(yield* events.until(isTag("turn.finished"))).outcome).toBe("completed");
      }
      expect(fake.calls.filter((call) => call.call === "createSession")).toHaveLength(1);
      const { events } = yield* getThread(thread.id);
      const replies = events.filter((stored) => stored.event._tag === "message.delta").map((stored) => stored.event);
      expect(textOf(replies).toLowerCase()).toContain("kiwi");
    }),
  );

  it.effect("shows an edit as an approval with its diff, and edits once approved", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("approval-approved");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = (yield* events.until(isTag("request.opened"))).at(-1);
      expect(opened).toMatchObject({ _tag: "request.opened", prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      if (opened?._tag !== "request.opened" || opened.prompt._tag !== "approval") throw new Error("no approval");
      expect(opened.prompt.detail).toContain("+Oolong too.");
      expect(yield* status(thread.id)).toBe("waiting");

      expect((yield* answer(thread.id, opened.requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
      const seen = yield* events.until(isTag("turn.finished"));
      expect(finishedOf(seen).outcome).toBe("completed");
      expect(fake.calls).toContainEqual({ call: "reply", requestId: opened.requestId, reply: "once" });
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "succeeded" }));
    }),
  );

  it.effect("tells the agent why when an edit is denied, and the turn carries on", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("approval-denied");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = yield* events.until(isTag("request.opened"));
      expect(opened.at(-1)).toMatchObject({ prompt: { _tag: "approval", title: "Edit Notes/Tea.md" } });
      const requestId = requestIdOf(opened);
      yield* answer(thread.id, requestId, { _tag: "approval", decision: "deny" });
      const seen = yield* events.until(isTag("turn.finished"));

      expect(fake.calls).toContainEqual({ call: "reply", requestId, reply: "reject", message: DENIED });
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "failed" }));
      expect(finishedOf(seen).outcome).toBe("completed");
      expect(textOf(seen).length).toBeGreaterThan(0);
    }),
  );

  it.effect("asks the agent's question and sends your answer", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("question");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const opened = (yield* events.until(isTag("request.opened"))).at(-1);
      expect(opened).toMatchObject({ prompt: { _tag: "question", options: ["Earl Grey", "Sencha"] } });
      if (opened?._tag !== "request.opened") throw new Error("no question");

      yield* answer(thread.id, opened.requestId, { _tag: "question", text: "Sencha" });
      const seen = yield* events.until(isTag("turn.finished"));
      expect(fake.calls).toContainEqual({ call: "reply", requestId: opened.requestId, reply: "Sencha" });
      expect(finishedOf(seen).outcome).toBe("completed");
      expect(textOf(seen)).toContain("Sencha");
    }),
  );

  it.effect("stops a turn OpenCode has already taken, when Stop comes straight after Send", () =>
    Effect.gen(function* () {
      // Recorded: withdrawing the message said yes, but OpenCode ran it anyway.
      const { thread, fake, prompts } = yield* setUp("interrupt-after-send");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      expect((yield* interrupt(thread.id)).status).toBe(200);
      expect(finishedOf(yield* events.until(isTag("turn.finished")))).toMatchObject({ outcome: "interrupted", reason: null });

      expect(fake.calls.map((call) => call.call)).toEqual(["createSession", "prompt", "cancelPrompt", "interrupt"]);
      yield* fake.played;
      expect(yield* fake.api.isRunning("")).toBe(false);
    }),
  );

  it.effect("withdraws a message OpenCode hasn't started, without interrupting", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("simple", { holdStart: true });
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* interrupt(thread.id);
      expect(finishedOf(yield* events.until(isTag("turn.finished"))).outcome).toBe("interrupted");
      yield* fake.played;
      expect(fake.calls.map((call) => call.call)).toEqual(["createSession", "prompt", "cancelPrompt"]);
    }),
  );

  it.effect("stops a turn mid-stream and keeps what it wrote", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts, fixture } = yield* setUp("interrupt-mid-stream");
      // What OpenCode had streamed when Stop was recorded.
      const steps = fixture.turns[0]!.steps;
      const stop = steps.findIndex((step) => "call" in step && step.call === "interrupt");
      const written = steps
        .slice(0, stop)
        .flatMap((step) => {
          const event = "event" in step ? (step.event as { type: string; data: { delta?: string } }) : undefined;
          return event?.type === "session.text.delta" && event.data.delta !== undefined ? [event.data.delta] : [];
        })
        .join("");
      expect(written).not.toBe("");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* events.until(isTag("message.delta"));
      yield* interrupt(thread.id);
      yield* fake.played;
      const { events: stored } = yield* getThread(thread.id);
      expect(stored.at(-1)?.event).toMatchObject({ _tag: "turn.finished", outcome: "interrupted" });
      expect(textOf(stored.map((event) => event.event))).toContain(written);
      expect(fake.calls.map((call) => call.call)).toContain("interrupt");
    }),
  );

  it.effect("finishes a turn whose end was lost, once the stream has been quiet", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("simple", { loseAfter: 12 });
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* fake.played;
      const done = yield* Effect.forkChild(events.until(isTag("turn.finished")));
      // The adapter checks on OpenCode after 45 s without events.
      for (let step = 0; step < 4 && done.pollUnsafe() === undefined; step++) yield* TestClock.adjust("46 seconds");
      const seen = yield* Fiber.join(done);
      expect(finishedOf(seen)).toMatchObject({ outcome: "completed", reason: null });
      expect(yield* status(thread.id)).toBe("idle");
    }),
  );

  it.effect("checks on the turn when the event stream reconnects", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("simple", { loseAfter: 12 });
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* fake.played;
      yield* fake.reconnect;
      expect(finishedOf(yield* events.until(isTag("turn.finished"))).outcome).toBe("completed");
    }),
  );

  it.effect("waits for an answer however long it takes", () =>
    Effect.gen(function* () {
      const { thread, prompts } = yield* setUp("question");
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
      yield* TestClock.adjust("10 minutes");
      expect(yield* status(thread.id)).toBe("waiting");
      yield* answer(thread.id, requestId, { _tag: "question", text: "Sencha" });
      expect(finishedOf(yield* events.until(isTag("turn.finished"))).outcome).toBe("completed");
    }),
  );

  it.effect("lists the thread's models and switches the session's model", () =>
    Effect.gen(function* () {
      const { thread, fake, prompts } = yield* setUp("multi-turn");
      const models = yield* HttpClient.get(`/api/threads/${thread.id}/models`).pipe(Effect.flatMap(decode(ListModelsResponse)));
      expect(models.current).toBe("opencode/big-pickle");
      expect(models.models.map((model) => model.id)).toContain("anthropic/claude-sonnet-5-5");

      const put = (model: string) =>
        HttpClient.execute(HttpClientRequest.put(`/api/threads/${thread.id}/model`).pipe(HttpClientRequest.bodyJsonUnsafe({ model })));
      expect((yield* put("nobody/nothing")).status).toBe(400);
      const before = yield* put("anthropic/claude-sonnet-5-5").pipe(Effect.flatMap(decode(SetModelResponse)));
      expect(before.thread.model).toBe("anthropic/claude-sonnet-5-5");

      // Chosen before the session exists: OpenCode creates it with that model.
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, prompts[0]!);
      yield* events.until(isTag("turn.finished"));
      expect(fake.calls[0]).toMatchObject({ call: "createSession", model: "anthropic/claude-sonnet-5-5" });

      // Chosen later: the open session switches.
      yield* put("opencode/big-pickle");
      expect(fake.calls.at(-1)).toEqual({ call: "switchModel", model: "opencode/big-pickle" });
      const after = yield* HttpClient.get(`/api/threads/${thread.id}/models`).pipe(Effect.flatMap(decode(ListModelsResponse)));
      expect(after.current).toBe("opencode/big-pickle");
    }),
  );

  it.effect("offers no models on the replay provider", () =>
    Effect.gen(function* () {
      const vault = yield* newVaultWith(VAULT_FILES);
      const thread = yield* newThread(vault.id, "replay");
      const models = yield* HttpClient.get(`/api/threads/${thread.id}/models`).pipe(Effect.flatMap(decode(ListModelsResponse)));
      expect(models).toEqual({ models: [], current: null });
      const put = HttpClient.execute(
        HttpClientRequest.put(`/api/threads/${thread.id}/model`).pipe(HttpClientRequest.bodyJsonUnsafe({ model: "opencode/big-pickle" })),
      );
      expect((yield* put).status).toBe(400);
    }),
  );
});

describe("OpenCode status", () => {
  const statusWith = (
    installedVersion: Effect.Effect<string, OpenCodeError>,
    start: Effect.Effect<OpenCodeApi, OpenCodeError, Scope.Scope> = Effect.die("OpenCode was started"),
  ) =>
    Effect.scoped(Effect.flatMap(makeOpenCodeAdapter({ start, installedVersion }), (adapter) => adapter.status));

  it.effect("reports an unsupported version without starting OpenCode", () =>
    Effect.gen(function* () {
      expect(yield* statusWith(Effect.succeed("1.19.5"))).toEqual({
        _tag: "unavailable",
        reason: "OpenCode 1.19.5 is installed; this app supports 2.2.x.",
      });
    }),
  );

  it.effect("reports a server that doesn't start", () =>
    Effect.gen(function* () {
      const failing = Effect.fail(new OpenCodeError({ message: "OpenCode exited (code 1) before it started: bad config" }));
      expect(yield* statusWith(Effect.succeed("2.2.4"), failing)).toEqual({
        _tag: "unavailable",
        reason: "OpenCode exited (code 1) before it started: bad config",
      });
    }),
  );

  it.effect("reports OpenCode missing from PATH", () =>
    Effect.gen(function* () {
      const result = yield* statusWith(binaryVersion("wiki-agents-no-such-opencode"));
      expect(result).toEqual({ _tag: "unavailable", reason: 'OpenCode isn\'t installed (no "wiki-agents-no-such-opencode" on PATH).' });
    }),
  );
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** The app over a database file and an OpenCode that outlives it (sessions are OpenCode's own data). */
const appOn = (file: string, fake: FakeOpenCode) =>
  makeHttpApp({ vaults: [], watch: false, providers: providersOver(Layer.succeed(Fake, fake)) }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

describe("OpenCode across a restart", () => {
  it.effect("closes a turn cut off by the restart, then continues the same OpenCode session", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-opencode-"))),
        (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
      );
      const file = join(dir, "app.db");
      const fake = yield* makeFakeOpenCode;
      const fixture = loadFixture("multi-turn");
      const run = <A, E>(body: Effect.Effect<A, E, Layer.Success<ReturnType<typeof appOn>> | Scope.Scope>) =>
        Effect.scoped(Effect.provide(body, appOn(file, fake)));

      // OpenCode never gets to start the turn before the server stops.
      const { thread, root } = yield* run(
        Effect.gen(function* () {
          const vault = yield* newVaultWith(VAULT_FILES);
          yield* fake.load(fixture, vault.rootPath, { holdStart: true });
          const thread = yield* newThread(vault.id, "opencode");
          yield* sendOk(thread.id, fixture.turns[0]!.prompt);
          return { thread, root: vault.rootPath };
        }),
      );

      const stored = yield* run(
        Effect.gen(function* () {
          const events = yield* watch(thread.id);
          const closed = (yield* getThread(thread.id)).events.some((event) => event.event._tag === "turn.finished");
          if (!closed) yield* events.until(isTag("turn.finished"));
          const before = (yield* getThread(thread.id)).events;
          expect(before.at(-1)?.event).toMatchObject({ _tag: "turn.finished", outcome: "interrupted", reason: SERVER_STOPPED });

          // The next message goes to the session the thread already has.
          yield* fake.load(fixture, root);
          const turnId = yield* sendOk(thread.id, fixture.turns[0]!.prompt);
          const seen = yield* events.until((event) => event._tag === "turn.finished" && event.turnId === turnId);
          expect(finishedOf(seen).outcome).toBe("completed");
          return (yield* getThread(thread.id)).events;
        }),
      );
      expect(fake.calls).toEqual([
        { call: "setPermissions", permissions: SESSION_PERMISSIONS },
        { call: "prompt", text: fixture.turns[0]!.prompt },
      ]);
      expect(tags(stored).filter((tag) => tag === "turn.finished")).toHaveLength(2);
    }),
  );
});
