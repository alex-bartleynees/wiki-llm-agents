import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { describe, expect, it, layer } from "@effect/vitest";
import { ListProvidersResponse } from "@wiki-agents/contracts/providers/list-providers/response";
import type { ThreadEvent } from "@wiki-agents/contracts/threads/model";
import { sql } from "drizzle-orm";
import { Effect, Layer, type Scope } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { makeHttpApp } from "../../src/app/layers.js";
import type { ProviderEvent } from "../../src/features/providers/port.js";
import { REPLAY_COMPACTION } from "../../src/features/providers/replay/adapter.js";
import { COMPACTION_CUT_OFF, COMPACTION_NOT_STARTED } from "../../src/features/threads/thread-actor.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { inbox, watchInbox } from "./infrastructure/schedules.js";
import { COMPACT, makeScriptedProvider } from "./infrastructure/scripted-provider.js";
import { makeTestApp, TestAgents, TestAttachments, TestSecrets, TestWorktrees } from "./infrastructure/test-app.js";
import { compact, compactOk, decode, getThread, interrupt, isTag, newThread, newVault, send, sendOk, status, tags, watch } from "./infrastructure/threads.js";

const provider = makeScriptedProvider();

const errorOf = (response: HttpClientResponse.HttpClientResponse) => Effect.map(response.text, (error) => ({ status: response.status, error }));

/** A replay thread with one finished turn, so there is a conversation to compact. */
const replayThreadWithATurn = Effect.gen(function* () {
  const thread = yield* newThread((yield* newVault).id);
  const events = yield* watch(thread.id);
  yield* sendOk(thread.id, "hello");
  yield* events.until(isTag("turn.finished"));
  return thread;
});

/** A scripted thread with one finished turn, whose compaction runs `events`. */
const scriptedThread = (events: (turnId: string) => ReadonlyArray<ProviderEvent>) =>
  Effect.gen(function* () {
    provider.scripts.set("*", () => Effect.succeed([]));
    provider.scripts.set(COMPACT, ({ turnId }) => Effect.succeed(events(turnId)));
    const thread = yield* newThread((yield* newVault).id, "scripted");
    const watching = yield* watch(thread.id);
    yield* sendOk(thread.id, "hello");
    yield* watching.until(isTag("turn.finished"));
    return thread;
  });

const compactionOf = (events: ReadonlyArray<ThreadEvent>) => events.find((event) => event._tag === "context.compaction");

layer(makeTestApp({ providers: provider.registry }))("compact conversation", (it) => {
  it.effect("says which providers can compact", () =>
    Effect.gen(function* () {
      const { providers } = yield* HttpClient.get("/api/providers").pipe(Effect.flatMap(decode(ListProvidersResponse)));
      expect(providers.map((each) => [each.id, each.capabilities.compact])).toEqual([
        ["replay", true],
        ["scripted", true],
      ]);
    }),
  );

  it.effect("compacts as a turn of its own and reports the provider's outcome", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      const events = yield* watch(thread.id);
      const { turnId, started } = yield* compactOk(thread.id);
      expect(started).toBe(true);
      const seen = yield* events.until(isTag("turn.finished"));
      expect(compactionOf(seen)).toEqual({ _tag: "context.compaction", turnId, outcome: "completed", trigger: "manual", ...REPLAY_COMPACTION.tokens });
      expect(seen.at(-1)).toEqual({ _tag: "turn.finished", turnId, outcome: "completed", usage: REPLAY_COMPACTION.usage, reason: null });
      const after = yield* getThread(thread.id);
      expect(tags(after.events.filter((stored) => stored.event.turnId === turnId))).toEqual(["compaction.requested", "turn.started", "context.compaction", "turn.finished"]);
      // A compaction doesn't name the thread.
      expect(after.thread.title).toBe("hello");
    }),
  );

  it.effect("refuses before there is a conversation, and for an operation id another turn has", () =>
    Effect.gen(function* () {
      const fresh = yield* newThread((yield* newVault).id);
      expect(yield* errorOf(yield* compact(fresh.id))).toEqual({ status: 409, error: "There's no conversation to compact yet." });
      expect((yield* getThread(fresh.id)).events).toEqual([]);

      const thread = yield* replayThreadWithATurn;
      const messageTurn = (yield* getThread(thread.id)).events[0]!.event.turnId;
      expect(yield* errorOf(yield* compact(thread.id, messageTurn))).toEqual({ status: 409, error: "That operation id is already used by another turn." });
      expect((yield* compact(thread.id, "not valid!")).status).toBe(400);
      expect((yield* compact("no-such-thread")).status).toBe(404);
    }),
  );

  it.effect("refuses while a turn runs, and refuses messages while it compacts", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      const running = yield* watch(thread.id);
      yield* sendOk(thread.id, "a long essay please");
      yield* running.until(isTag("message.delta"), "100 millis");
      expect(yield* errorOf(yield* compact(thread.id))).toEqual({ status: 409, error: "A turn is running or waiting for you" });
      yield* running.until(isTag("turn.finished"));

      const compacting = yield* watch(thread.id);
      yield* compactOk(thread.id);
      expect(yield* status(thread.id)).toBe("running");
      expect((yield* send(thread.id, "are you done?")).status).toBe(409);
      yield* compacting.until(isTag("turn.finished"));
      expect(yield* status(thread.id)).toBe("idle");
    }),
  );

  it.effect("stops a compaction like a turn, without claiming an outcome", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      const events = yield* watch(thread.id);
      const { turnId } = yield* compactOk(thread.id);
      expect((yield* interrupt(thread.id)).status).toBe(200);
      const seen = yield* events.until(isTag("turn.finished"));
      expect(seen.at(-1)).toEqual({ _tag: "turn.finished", turnId, outcome: "interrupted", usage: null, reason: null });
      expect(compactionOf(seen)).toBeUndefined();
      expect(yield* status(thread.id)).toBe("idle");
    }),
  );

  it.effect("compacts once per operation id: a retry returns the same turn", () =>
    Effect.gen(function* () {
      const thread = yield* replayThreadWithATurn;
      const operationId = crypto.randomUUID();
      const events = yield* watch(thread.id);
      expect(yield* compactOk(thread.id, operationId)).toEqual({ turnId: operationId, started: true });
      // Retried while it runs, and after it finished.
      expect(yield* compactOk(thread.id, operationId)).toEqual({ turnId: operationId, started: false });
      yield* events.until(isTag("turn.finished"));
      expect(yield* compactOk(thread.id, operationId)).toEqual({ turnId: operationId, started: false });
      expect(tags((yield* getThread(thread.id)).events).filter((tag) => tag === "compaction.requested")).toHaveLength(1);
    }),
  );

  it.effect("shows a compaction the provider didn't report as a no-op, never as compacted", () =>
    Effect.gen(function* () {
      const thread = yield* scriptedThread(() => []);
      const events = yield* watch(thread.id);
      const { turnId } = yield* compactOk(thread.id);
      const seen = yield* events.until(isTag("turn.finished"));
      expect(compactionOf(seen)).toEqual({ _tag: "context.compaction", turnId, outcome: "noop", trigger: "manual" });
      expect(seen.at(-1)).toMatchObject({ outcome: "completed" });
    }),
  );

  it.effect("reports a failed compaction, with an inbox item; a completed one leaves the turn's result alone", () =>
    Effect.gen(function* () {
      const thread = yield* scriptedThread((turnId) => [
        { _tag: "context.compaction", turnId, outcome: "failed", trigger: "manual", reason: "Not enough messages to compact." },
        { _tag: "turn.finished", turnId, outcome: "failed", usage: null, reason: "Not enough messages to compact." },
      ]);
      const watching = yield* watchInbox;
      const failed = yield* watching.until(
        (item) => item.kind === "turn.failed" && item.source.threadId === thread.id,
        compactOk(thread.id),
      );
      expect(failed).toMatchObject({ title: "Failed: hello", body: "Not enough messages to compact." });

      provider.scripts.set(COMPACT, ({ turnId }) => Effect.succeed([{ _tag: "context.compaction", turnId, outcome: "completed", trigger: "manual" }]));
      const events = yield* watch(thread.id);
      yield* compactOk(thread.id);
      yield* events.until(isTag("turn.finished"));
      // The next message closes the failed item; until then it is the thread's only open one.
      expect((yield* inbox).filter((item) => item.source.threadId === thread.id && item.state === "open").map((item) => item.id)).toEqual([failed.id]);
    }),
  );
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const appOn = (file: string) =>
  makeHttpApp({ vaults: [], watch: false, providers: provider.registry, agents: TestAgents, attachments: TestAttachments, worktrees: TestWorktrees, secrets: TestSecrets }).pipe(
    Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
    Layer.provideMerge(NodeHttpServer.layerTest),
  );
const run = <A, E>(file: string, body: Effect.Effect<A, E, Layer.Success<ReturnType<typeof appOn>> | Scope.Scope>) => Effect.scoped(Effect.provide(body, appOn(file)));
const tempDatabase = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-compaction-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
).pipe(Effect.map((dir) => join(dir, "app.db")));

describe("compact conversation across a restart", () => {
  it.effect("never continues a compaction the server stopped during", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const { threadId, turnId } = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* replayThreadWithATurn;
          // Replay compacts after a pause the test clock never reaches.
          const { turnId } = yield* compactOk(thread.id);
          return { threadId: thread.id, turnId };
        }),
      );
      const after = yield* run(
        file,
        Effect.gen(function* () {
          yield* (yield* ThreadActors).wake(threadId);
          return yield* getThread(threadId);
        }),
      );
      expect(after.events.at(-1)?.event).toEqual({ _tag: "turn.finished", turnId, outcome: "interrupted", usage: null, reason: COMPACTION_CUT_OFF });
      expect(tags(after.events).filter((tag) => tag === "context.compaction")).toEqual([]);
      expect(after.thread.status).toBe("idle");
    }),
  );

  it.effect("never starts a compaction that was recorded but not sent", () =>
    Effect.gen(function* () {
      const file = yield* tempDatabase;
      const { threadId, turnId } = yield* run(
        file,
        Effect.gen(function* () {
          const thread = yield* replayThreadWithATurn;
          const events = yield* watch(thread.id);
          const { turnId } = yield* compactOk(thread.id);
          yield* events.until(isTag("turn.finished"));
          // As if the server stopped between recording the compaction and asking the provider.
          const { db } = yield* Sqlite;
          db.run(sql`DELETE FROM thread_events WHERE thread_id = ${thread.id} AND seq > (SELECT MIN(seq) + 1 FROM thread_events WHERE thread_id = ${thread.id} AND type = 'compaction.requested')`);
          db.run(sql`UPDATE turns SET status = 'running', ended_at = NULL WHERE id = ${turnId}`);
          db.run(sql`INSERT INTO outbox (id, kind, payload, next_attempt_at) VALUES (${`turn.start:${turnId}`}, 'turn.start', '{}', 0)`);
          return { threadId: thread.id, turnId };
        }),
      );
      const after = yield* run(
        file,
        Effect.gen(function* () {
          yield* (yield* ThreadActors).wake(threadId);
          return yield* getThread(threadId);
        }),
      );
      expect(after.events.at(-1)?.event).toEqual({ _tag: "turn.finished", turnId, outcome: "interrupted", usage: null, reason: COMPACTION_NOT_STARTED });
      expect(tags(after.events).filter((tag) => tag === "context.compaction")).toEqual([]);
    }),
  );
});
