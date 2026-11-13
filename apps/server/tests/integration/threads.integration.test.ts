import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import { ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import { CreateThreadResponse } from "@wiki-agents/contracts/threads/create-thread/response";
import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { ListThreadsResponse } from "@wiki-agents/contracts/threads/list-threads/response";
import { MarkDoneResponse } from "@wiki-agents/contracts/threads/mark-done/response";
import { ReopenThreadResponse } from "@wiki-agents/contracts/threads/reopen-thread/response";
import type { RequestAnswer, StoredThreadEvent, ThreadEvent, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { SendMessageResponse } from "@wiki-agents/contracts/threads/send-message/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { sql } from "drizzle-orm";
import { Clock, type Duration, Effect, Fiber, Layer, PubSub, Schema, type Scope, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { makeHttpApp } from "../../src/app/layers.js";
import { makeProviderRegistry } from "../../src/features/providers/registry-live.js";
import { PROVIDER_GONE, SERVER_STOPPED } from "../../src/features/threads/thread-actor.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { ReplayOnly, TestAgents, TestApp } from "./infrastructure/test-app.js";
import { makeTestVault } from "./infrastructure/test-vault.js";

import {
  answer,
  decode,
  getThread,
  interrupt,
  isTag,
  markDone,
  newThread,
  newVault,
  PLAY_ALL,
  post,
  reopen,
  requestIdOf,
  send,
  sendOk,
  status,
  tags,
  watch,
} from "./infrastructure/threads.js";

layer(TestApp)("threads", (it) => {
  it.effect("lists the replay provider", () =>
    Effect.gen(function* () {
      const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
      expect(providers).toEqual([
        expect.objectContaining({ id: "replay", kind: "replay", capabilities: { interrupt: true, resume: true, approvals: true, questions: true, models: false } }),
      ]);
    }),
  );

  it.effect("creates threads per vault, newest first, untitled until the first message", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const other = yield* newVault;
      const first = yield* newThread(vault.id);
      yield* TestClock.adjust("1 second");
      const second = yield* newThread(vault.id);
      yield* newThread(other.id);
      expect(first).toMatchObject({ vaultId: vault.id, title: null, providerInstanceId: "replay", status: "idle", lastSeq: 0 });
      const { threads } = yield* HttpClient.get(`/api/vaults/${vault.id}/threads`).pipe(Effect.flatMap(decode(ListThreadsResponse)));
      expect(threads.map((thread) => thread.id)).toEqual([second.id, first.id]);
      expect(yield* getThread(first.id)).toEqual({ thread: first, events: [] });
    }),
  );

  it.effect("streams a turn to the end and records it", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id);
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, "What is this vault about?");
      const seen = yield* events.until(isTag("turn.finished"));

      expect(seen.at(-1)).toEqual({
        _tag: "turn.finished",
        turnId,
        outcome: "completed",
        usage: { inputTokens: 12_455, outputTokens: 187, costUsd: 0.0263 },
        reason: null,
      });
      const { thread: after, events: stored } = yield* getThread(thread.id);
      expect(tags(stored).slice(0, 4)).toEqual(["user.message", "turn.started", "tool.called", "tool.finished"]);
      expect(stored.map((event) => event.seq)).toEqual(stored.map((_, index) => index + 1));
      expect(after).toMatchObject({ title: "What is this vault about?", status: "idle", lastSeq: stored.length });
      const reply = stored.flatMap((event) => (event.event._tag === "message.delta" ? [event.event.text] : [])).join("");
      expect(reply).toContain("Wiki-LLM-Agents-App");
      const { db } = yield* Sqlite;
      expect(db.get(sql`SELECT status, input_tokens AS tokens FROM turns WHERE id = ${turnId}`)).toEqual({ status: "completed", tokens: 12_455 });
      expect(db.get(sql`SELECT COUNT(*) AS n FROM outbox`)).toEqual({ n: 0 });
    }),
  );

  it.effect("refuses a second message while a turn runs, and starts one turn", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const [first, second] = yield* Effect.all([send(thread.id, "one"), send(thread.id, "two")], { concurrency: "unbounded" });
      expect([first.status, second.status].sort()).toEqual([202, 409]);
      expect(yield* status(thread.id)).toBe("running");
      const { events } = yield* getThread(thread.id);
      expect(tags(events)).toEqual(["user.message", "turn.started"]);
    }),
  );

  it.effect("stops a turn interrupted straight after it was sent", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const turnId = yield* sendOk(thread.id, "hello");
      expect((yield* interrupt(thread.id)).status).toBe(200);
      yield* TestClock.adjust(PLAY_ALL);
      const { thread: after, events } = yield* getThread(thread.id);
      expect(tags(events)).toEqual(["user.message", "turn.started", "turn.finished"]);
      expect(events.at(-1)?.event).toEqual({ _tag: "turn.finished", turnId, outcome: "interrupted", usage: null, reason: null });
      expect(after.status).toBe("idle");
      expect((yield* interrupt(thread.id)).status).toBe(409);
      // The thread takes the next message.
      expect((yield* send(thread.id, "again")).status).toBe(202);
    }),
  );

  it.effect("waits for an approval and continues with the answer", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "please edit the plan");
      const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
      expect(yield* status(thread.id)).toBe("waiting");
      // Nothing more happens until it is answered.
      yield* TestClock.adjust(PLAY_ALL);
      expect(tags((yield* getThread(thread.id)).events).at(-1)).toBe("request.opened");

      expect((yield* answer(thread.id, requestId, { _tag: "question", text: "yes" })).status).toBe(409);
      expect((yield* answer(thread.id, "nope", { _tag: "approval", decision: "approve" })).status).toBe(404);
      expect((yield* answer(thread.id, requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
      const rest = yield* events.until(isTag("turn.finished"));
      expect(rest[0]).toEqual({ _tag: "request.resolved", turnId: expect.any(String), requestId, answer: { _tag: "approval", decision: "approve" } });
      expect(rest).toContainEqual(expect.objectContaining({ _tag: "tool.called", name: "edit" }));
      expect(rest.at(-1)).toMatchObject({ outcome: "completed" });
      expect((yield* answer(thread.id, requestId, { _tag: "approval", decision: "deny" })).status).toBe(409);
    }),
  );

  it.effect("plays the deny branch, and answers questions with text", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "edit something");
      const denied = requestIdOf(yield* events.until(isTag("request.opened")));
      yield* answer(thread.id, denied, { _tag: "approval", decision: "deny" });
      const afterDeny = yield* events.until(isTag("turn.finished"));
      expect(afterDeny).not.toContainEqual(expect.objectContaining({ _tag: "tool.called" }));

      yield* sendOk(thread.id, "ask me a question");
      const question = requestIdOf(yield* events.until(isTag("request.opened")));
      yield* answer(thread.id, question, { _tag: "question", text: "3-Resources/" });
      const reply = (yield* events.until(isTag("turn.finished")))
        .flatMap((event) => (event._tag === "message.delta" ? [event.text] : []))
        .join("");
      expect(reply).toBe("Got it, I'll put it in `3-Resources/`.");
    }),
  );

  it.effect("cancels a pending request when its turn is interrupted", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "edit the plan");
      const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
      yield* interrupt(thread.id);
      const { events: stored } = yield* getThread(thread.id);
      expect(stored.slice(-2).map((event) => event.event)).toEqual([
        { _tag: "request.resolved", turnId: expect.any(String), requestId, answer: null },
        expect.objectContaining({ _tag: "turn.finished", outcome: "interrupted" }),
      ]);
      const response = yield* answer(thread.id, requestId, { _tag: "approval", decision: "approve" });
      expect(response.status).toBe(409);
      expect(yield* response.text).toBe("Request already cancelled");
    }),
  );

  it.effect("records a turn the provider fails", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "this will fail");
      const seen = yield* events.until(isTag("turn.finished"));
      expect(seen.at(-1)).toMatchObject({ outcome: "failed", reason: "The provider stopped with an error (recorded)." });
      expect(seen).toContainEqual(expect.objectContaining({ _tag: "tool.finished", status: "failed" }));
    }),
  );

  it.effect("marks an idle thread done and reopens it, keeping its place in the list", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const thread = yield* newThread(vault.id);
      const threadUpdates = yield* (yield* ThreadBus).subscribeThreads;
      yield* TestClock.adjust("1 minute");
      const markedAt = yield* Clock.currentTimeMillis;

      const marked = yield* markDone(thread.id).pipe(Effect.flatMap(decode(MarkDoneResponse)));
      expect(marked.thread).toEqual({ ...thread, doneAt: markedAt });
      expect(yield* PubSub.take(threadUpdates)).toEqual(marked.thread);
      const { threads } = yield* HttpClient.get(`/api/vaults/${vault.id}/threads`).pipe(Effect.flatMap(decode(ListThreadsResponse)));
      expect(threads).toEqual([marked.thread]);

      // Marking it again keeps the first time.
      yield* TestClock.adjust("1 minute");
      expect((yield* markDone(thread.id).pipe(Effect.flatMap(decode(MarkDoneResponse)))).thread.doneAt).toBe(markedAt);

      const reopened = yield* reopen(thread.id).pipe(Effect.flatMap(decode(ReopenThreadResponse)));
      expect(reopened.thread).toEqual(thread);
      expect((yield* reopen(thread.id).pipe(Effect.flatMap(decode(ReopenThreadResponse)))).thread.doneAt).toBeNull();
      expect((yield* markDone("missing")).status).toBe(404);
      expect((yield* reopen("missing")).status).toBe(404);
    }),
  );

  it.effect("refuses to mark a thread done while a turn runs or waits for an answer", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "please edit the plan");
      expect((yield* markDone(thread.id)).status).toBe(409);
      const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
      const refused = yield* markDone(thread.id);
      expect(refused.status).toBe(409);
      expect(yield* refused.text).toBe("Stop the turn or answer it before marking the thread done");

      yield* answer(thread.id, requestId, { _tag: "approval", decision: "deny" });
      yield* events.until(isTag("turn.finished"));
      expect((yield* markDone(thread.id)).status).toBe(200);
    }),
  );

  it.effect("reopens a done thread when it gets a message", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      yield* markDone(thread.id).pipe(Effect.flatMap(decode(MarkDoneResponse)));
      const threadUpdates = yield* (yield* ThreadBus).subscribeThreads;
      yield* sendOk(thread.id, "hello again");
      expect(yield* PubSub.take(threadUpdates)).toMatchObject({ id: thread.id, doneAt: null, status: "running" });
      expect((yield* getThread(thread.id)).thread.doneAt).toBeNull();
    }),
  );

  it.effect("rejects unknown threads, empty messages, and other origins", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      expect((yield* send("missing", "hi")).status).toBe(404);
      expect((yield* HttpClient.get("/api/threads/missing")).status).toBe(404);
      expect((yield* send(thread.id, "")).status).toBe(400);
      expect((yield* post("/api/vaults/missing/threads", {})).status).toBe(404);
      expect((yield* post(`/api/vaults/${thread.vaultId}/threads`, { providerInstanceId: "nope" })).status).toBe(400);
      const foreign = yield* HttpClient.execute(
        HttpClientRequest.post(`/api/threads/${thread.id}/messages`).pipe(
          HttpClientRequest.setHeader("origin", "https://evil.example"),
          HttpClientRequest.bodyJsonUnsafe({ text: "hi" }),
        ),
      );
      expect(foreign.status).toBe(403);
    }),
  );
});

/** Reads `data:` messages from an SSE response until `done` matches one. */
const readStream = (
  path: string,
  done: (message: ThreadStreamMessage) => boolean,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(HttpClientRequest.get(path).pipe(HttpClientRequest.setHeaders(headers)));
    expect(response.status).toBe(200);
    const decodeMessage = Schema.decodeUnknownSync(Schema.fromJsonString(ThreadStreamMessage));
    return yield* response.stream.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.filter((line) => line.startsWith("data: ")),
      Stream.map((line) => decodeMessage(line.slice("data: ".length))),
      Stream.takeUntil(done),
      Stream.runCollect,
    );
  });

const seqs = (messages: ReadonlyArray<ThreadStreamMessage>) => messages.flatMap((message) => (message.type === "event" ? [message.event.seq] : []));

layer(TestApp)("thread event stream", (it) => {
  it.effect("replays stored events after a seq, from ?after= or Last-Event-ID", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      yield* events.until(isTag("turn.finished"));
      const { thread: done } = yield* getThread(thread.id);
      const last = (message: ThreadStreamMessage) => message.type === "event" && message.event.seq === done.lastSeq;

      const all = yield* readStream(`/events/threads/${thread.id}`, last);
      expect(all[0]).toEqual({ type: "ready" });
      expect(seqs(all)).toEqual(Array.from({ length: done.lastSeq }, (_, index) => index + 1));
      expect(seqs(yield* readStream(`/events/threads/${thread.id}?after=3`, last))).toEqual(seqs(all).slice(3));
      expect(seqs(yield* readStream(`/events/threads/${thread.id}?after=1`, last, { "last-event-id": "5" }))).toEqual(seqs(all).slice(5));
      expect((yield* HttpClient.get(`/events/threads/${thread.id}?after=-1`)).status).toBe(400);
      expect((yield* HttpClient.get("/events/threads/missing")).status).toBe(404);
    }),
  );

  it.effect("continues from stored events into live ones without gaps or repeats", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      yield* sendOk(thread.id, "edit the plan");
      const requestId = requestIdOf(yield* events.until(isTag("request.opened")));
      const finished = (message: ThreadStreamMessage) => message.type === "event" && message.event.event._tag === "turn.finished";
      const reader = yield* Effect.forkChild(readStream(`/events/threads/${thread.id}?after=2`, finished));
      // However the reader's connection interleaves with the turn, stored and live events
      // together must give every seq after 2 exactly once.
      yield* answer(thread.id, requestId, { _tag: "approval", decision: "approve" });
      yield* events.until(isTag("turn.finished"));
      const messages = yield* Fiber.join(reader);
      const { thread: done } = yield* getThread(thread.id);
      expect(seqs(messages)).toEqual(Array.from({ length: done.lastSeq - 2 }, (_, index) => index + 3));
    }),
  );
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * The app over a given database file, as if started again; ThreadsStartup runs as
 * part of it. Closing the scope stops it, like stopping the server.
 */
const appOn = (file: string, providers: typeof ReplayOnly = ReplayOnly) =>
  makeHttpApp({ vaults: [], watch: false, providers, agents: TestAgents }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );

type App = Layer.Success<ReturnType<typeof appOn>>;

/** Runs `body` in a fresh copy of the app over `file`, then stops it. */
const run = <A, E>(file: string, body: Effect.Effect<A, E, App | Scope.Scope>, providers?: typeof ReplayOnly) =>
  Effect.scoped(Effect.provide(body, appOn(file, providers)));

/** No providers at all, as when a thread's provider (replay, outside tests) is no longer run. */
const NoProviders = makeProviderRegistry(Effect.succeed([]));

const tempDatabase = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-restart-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
).pipe(Effect.map((dir) => join(dir, "app.db")));

/**
 * Waits for the thread's turn to finish after a restart. Startup wakes the actor in
 * the background; waking it again waits until it has resumed (and started any
 * timers), so moving the test clock can't skip past them.
 */
const finishedAfterRestart = (thread: ThreadSummary, act: Effect.Effect<unknown, unknown, App>) =>
  Effect.gen(function* () {
    const events = yield* watch(thread.id);
    yield* act;
    yield* (yield* ThreadActors).wake(thread.id);
    const done = (yield* getThread(thread.id)).events.some((event) => event.event._tag === "turn.finished");
    if (!done) yield* events.until(isTag("turn.finished"));
    return yield* getThread(thread.id);
  });

describe("threads across a restart", () => {
  it.effect("keeps a pending approval answerable and finishes the turn", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const { thread, requestId } = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* newThread((yield* newVault).id);
          const events = yield* watch(thread.id);
          yield* sendOk(thread.id, "edit the plan");
          return { thread, requestId: requestIdOf(yield* events.until(isTag("request.opened"))) };
        }),
      );

      const after = yield* run(
        file,
        finishedAfterRestart(
          thread,
          Effect.gen(function* () {
            expect(yield* status(thread.id)).toBe("waiting");
            expect((yield* answer(thread.id, requestId, { _tag: "approval", decision: "approve" })).status).toBe(200);
          }),
        ),
      );
      expect(tags(after.events).filter((tag) => tag === "request.opened")).toHaveLength(1);
      expect(after.events.at(-1)?.event).toMatchObject({ _tag: "turn.finished", outcome: "completed" });
      expect(after.events.map((event) => event.event)).toContainEqual(expect.objectContaining({ _tag: "tool.called", name: "edit" }));
      expect(after.thread.status).toBe("idle");
    }),
  );

  it.effect("closes a turn that was streaming when the server stopped", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const thread = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* newThread((yield* newVault).id);
          const events = yield* watch(thread.id);
          yield* sendOk(thread.id, "a long essay please");
          yield* events.until(isTag("message.delta"), "100 millis");
          return thread;
        }),
      );
      const after = yield* run(file, finishedAfterRestart(thread, Effect.void));
      expect(after.events.at(-1)?.event).toMatchObject({ _tag: "turn.finished", outcome: "interrupted", reason: SERVER_STOPPED });
      expect(after.thread.status).toBe("idle");
    }),
  );

  it.effect("starts a turn that was recorded but never reached the provider", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const { thread, turnId } = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* newThread((yield* newVault).id);
          const turnId = yield* sendOk(thread.id, "hello");
          // As if the server stopped between writing the turn and starting the provider.
          const { db } = yield* Sqlite;
          db.run(
            sql`INSERT INTO outbox (id, kind, payload, next_attempt_at) VALUES (${`turn.start:${turnId}`}, 'turn.start', '{}', 0)`,
          );
          return { thread, turnId };
        }),
      );
      const after = yield* run(file, finishedAfterRestart(thread, Effect.void));
      expect(after.events.at(-1)?.event).toMatchObject({ _tag: "turn.finished", turnId, outcome: "completed" });
      expect(tags(after.events).filter((tag) => tag === "user.message")).toHaveLength(1);
    }),
  );

  it.effect("keeps a thread whose provider is gone readable, and fails its turns saying why", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const thread = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* newThread((yield* newVault).id);
          const events = yield* watch(thread.id);
          yield* sendOk(thread.id, "hello");
          yield* events.until(isTag("turn.finished"));
          return thread;
        }),
      );

      const after = yield* run(
        file,
        Effect.gen(function* () {
          const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
          expect(providers).toEqual([]);
          expect((yield* getThread(thread.id)).events.map((event) => event.event)).toContainEqual(expect.objectContaining({ _tag: "turn.finished", outcome: "completed" }));
          expect((yield* markDone(thread.id)).status).toBe(200);

          const events = yield* watch(thread.id);
          const turnId = yield* sendOk(thread.id, "hello again");
          const seen = yield* events.until((event) => event._tag === "turn.finished" && event.turnId === turnId);
          return seen.at(-1);
        }),
        NoProviders,
      );
      expect(after).toMatchObject({ _tag: "turn.finished", outcome: "failed", reason: PROVIDER_GONE });
    }),
  );
});
