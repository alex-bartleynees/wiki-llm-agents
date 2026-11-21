import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { expect, it, layer } from "@effect/vitest";
import { SubscribeResponse } from "@wiki-agents/contracts/events/subscribe/response";
import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import { GetInactivityPolicyResponse } from "@wiki-agents/contracts/threads/get-inactivity-policy/response";
import { RegisterVaultResponse } from "@wiki-agents/contracts/vaults/register-vault/response";
import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, PubSub, Schema, type Scope } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import { makeHttpApp } from "../../src/app/layers.js";
import { ThreadActors } from "../../src/features/threads/thread-actors.js";
import { ThreadBus } from "../../src/features/threads/thread-bus.js";
import { makeSqlite, Sqlite } from "../../src/shared/persistence/sqlite.js";
import { openEvents, type Delivered } from "./infrastructure/events.js";
import { ReplayOnly, TestAgents, TestApp, TestAttachments, TestSecrets, TestWorktrees } from "./infrastructure/test-app.js";
import { makeTestVault } from "./infrastructure/test-vault.js";
import { answer, decode, getThread, isTag, markDone, newThread, newVault, post, reopen, requestIdOf, sendOk, watch } from "./infrastructure/threads.js";

const path = "/api/settings/thread-inactivity";
const put = (path: string, body: unknown) =>
  HttpClient.execute(HttpClientRequest.put(path).pipe(HttpClientRequest.bodyJsonUnsafe(body)));
const configure = (enabled: boolean, days: number) => put(path, { policy: { enabled, days } });
const getPolicy = HttpClient.get(path).pipe(Effect.flatMap(decode(GetInactivityPolicyResponse)));
const day = 86_400_000;
const stream = Effect.gen(function* () {
  const events = yield* openEvents;
  yield* events.subscribe("all", { type: "all-threads" }).pipe(Effect.flatMap(decode(SubscribeResponse)));
  return events;
});
const decodeMessage = Schema.decodeUnknownSync(ThreadsStreamMessage);
const completed = (id: string) => (frame: Delivered) => {
  const message = decodeMessage(frame.message);
  return message.type === "thread.updated" && message.thread.id === id && message.thread.doneReason === "inactivity";
};
const draft = (id: string, text: string, sequence: number) =>
  put(`/api/threads/${id}/draft`, { text, sequence, baseVersion: sequence - 1, writerId: "test" });

layer(TestApp)("thread inactivity", (it) => {
  it.effect("validates and persists a disabled policy, then sweeps at the cutoff and after shortening", () => Effect.gen(function* () {
    expect(yield* getPolicy).toEqual({ policy: { enabled: false, days: 30 } });
    for (const invalid of [0, 366, 1.5]) expect((yield* configure(true, invalid)).status).toBe(400);
    const vault = yield* newVault;
    const older = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const target = yield* newThread(vault.id);
    const manual = yield* newThread(vault.id);
    expect((yield* markDone(manual.id)).status).toBe(200);
    const before = (yield* getThread(manual.id)).thread;
    yield* TestClock.adjust(day - 1);
    expect((yield* getThread(older.id)).thread.doneAt).toBeNull();

    const first = yield* stream;
    const second = yield* stream;
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* first.until(completed(older.id));
    yield* second.until(completed(older.id));
    expect((yield* getThread(target.id)).thread.doneAt).toBeNull();
    expect((yield* configure(true, 2)).status).toBe(200);
    yield* TestClock.adjust(1);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* first.until(completed(target.id));
    const done = (yield* getThread(target.id)).thread;
    expect(done).toMatchObject({ doneReason: "inactivity", doneAt: target.createdAt + day });
    expect((yield* getThread(manual.id)).thread).toMatchObject({ doneReason: null, doneAt: before.doneAt });

    expect((yield* configure(false, 1)).status).toBe(200);
    expect(yield* getPolicy).toEqual({ policy: { enabled: false, days: 1 } });
    yield* TestClock.adjust(day);
    expect((yield* getThread(target.id)).thread.doneAt).toBe(done.doneAt);
  }));

  it.effect("honors a disable while the current batch has candidates left", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const first = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const held = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const last = yield* newThread(vault.id);
    const updates = yield* stream;
    const actors = yield* ThreadActors;
    const entered = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const hold = yield* Effect.forkChild(actors.whileIdle(held.id,
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(released))),
    ));
    yield* Deferred.await(entered);

    yield* Effect.gen(function* () {
      yield* TestClock.adjust(day);
      expect((yield* configure(true, 1)).status).toBe(200);
      yield* updates.until(completed(first.id));
      expect((yield* configure(false, 1)).status).toBe(200);
    }).pipe(Effect.ensuring(Deferred.succeed(released, undefined)));
    yield* Fiber.join(hold);
    yield* actors.withChildMutation(held.id, Effect.void);
    expect((yield* getThread(held.id)).thread.doneAt).toBeNull();
    expect((yield* getThread(last.id)).thread.doneAt).toBeNull();

    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(last.id));
    expect((yield* getThread(held.id)).thread.doneReason).toBe("inactivity");
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("rechecks accepted sends and drafts after candidate selection", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const first = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const held = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const sent = yield* newThread(vault.id);
    const drafted = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const sentinel = yield* newThread(vault.id);
    const updates = yield* stream;
    const actors = yield* ThreadActors;
    const entered = yield* Deferred.make<void>();
    const released = yield* Deferred.make<void>();
    const hold = yield* Effect.forkChild(actors.whileIdle(held.id,
      Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(released))),
    ));
    yield* Deferred.await(entered);

    const seen = yield* Effect.gen(function* () {
      yield* TestClock.adjust(day);
      expect((yield* configure(true, 1)).status).toBe(200);
      const firstBatch = yield* updates.until(completed(first.id));
      yield* sendOk(sent.id, "New activity");
      expect((yield* draft(drafted.id, "Keep this draft", 1)).status).toBe(200);
      return firstBatch;
    }).pipe(Effect.ensuring(Deferred.succeed(released, undefined)));
    yield* Fiber.join(hold);
    const finished = [...seen, ...(yield* updates.until(completed(sentinel.id)))];
    expect(finished.some(completed(sent.id))).toBe(false);
    expect(finished.some(completed(drafted.id))).toBe(false);
    expect((yield* getThread(sent.id)).thread).toMatchObject({ doneAt: null, doneReason: null });
    expect((yield* getThread(drafted.id)).thread).toMatchObject({ doneAt: null, doneReason: null });
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("completes more than one page with equal activity timestamps", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const candidates = yield* Effect.forEach(Array.from({ length: 70 }), () => newThread(vault.id));
    expect(new Set(candidates.map(({ createdAt }) => createdAt)).size).toBe(1);
    const remaining = new Set(candidates.map(({ id }) => id));
    const updates = yield* stream;
    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    const seen = yield* updates.until((frame) => {
      const message = decodeMessage(frame.message);
      if (message.type === "thread.updated" && message.thread.doneReason === "inactivity") remaining.delete(message.thread.id);
      return remaining.size === 0;
    });
    const ids = new Set(candidates.map(({ id }) => id));
    expect(seen.flatMap((frame) => {
      const message = decodeMessage(frame.message);
      return message.type === "thread.updated" && ids.has(message.thread.id) ? [message.thread.id] : [];
    })).toEqual([...ids].sort());
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("continues a failed sweep and retries the failed candidate after one minute", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const target = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const sentinel = yield* newThread(vault.id);
    const { db } = yield* Sqlite;
    db.run(sql`UPDATE threads SET title = 'retry fixture' WHERE id = ${target.id}`);
    db.run(sql`CREATE TEMP TRIGGER fail_inactivity_completion BEFORE UPDATE OF done_reason ON threads
      WHEN NEW.done_reason = 'inactivity' AND NEW.title = 'retry fixture'
      BEGIN SELECT RAISE(ABORT, 'injected inactivity write failure'); END`);
    const updates = yield* stream;
    yield* Effect.gen(function* () {
      yield* TestClock.adjust(day);
      expect((yield* configure(true, 1)).status).toBe(200);
      yield* updates.until(completed(sentinel.id));
      expect((yield* getThread(target.id)).thread.doneAt).toBeNull();
    }).pipe(Effect.ensuring(Effect.sync(() => void db.run(sql`DROP TRIGGER fail_inactivity_completion`))));

    yield* TestClock.adjust(59_999);
    expect((yield* getThread(target.id)).thread.doneAt).toBeNull();
    yield* TestClock.adjust(1);
    yield* updates.until(completed(target.id));
    expect((yield* getThread(target.id)).thread.doneAt).toBe(sentinel.createdAt + day + 60_000);
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("reopens an automatically completed manager when its child starts work and preserves manual Done", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const manager = yield* newThread(vault.id);
    const child = yield* newThread(vault.id);
    const manual = yield* newThread(vault.id);
    const manualChild = yield* newThread(vault.id);
    const { db } = yield* Sqlite;
    db.run(sql`UPDATE threads SET parent_thread_id = ${manager.id} WHERE id = ${child.id}`);
    db.run(sql`UPDATE threads SET parent_thread_id = ${manual.id} WHERE id = ${manualChild.id}`);
    expect((yield* markDone(manual.id)).status).toBe(200);
    const manualDoneAt = (yield* getThread(manual.id)).thread.doneAt;
    const updates = yield* stream;

    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(manager.id));
    yield* sendOk(child.id, "Ask me a question");
    yield* updates.until((frame) => {
      const message = decodeMessage(frame.message);
      return message.type === "thread.updated" && message.thread.id === manager.id && message.thread.doneAt === null;
    });
    expect((yield* getThread(manager.id)).thread).toMatchObject({ doneAt: null, doneReason: null });
    expect((yield* getThread(child.id)).thread.status).toBe("running");
    yield* sendOk(manualChild.id, "Ask me a question");
    expect((yield* getThread(manual.id)).thread).toMatchObject({ doneAt: manualDoneAt, doneReason: null });
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("leaves persisted work queued for provider dispatch open", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const target = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const sentinel = yield* newThread(vault.id);

    const { db } = yield* Sqlite;
    const turnId = `queued-${target.id}`;
    db.transaction((tx) => {
      tx.run(sql`INSERT INTO turns (id, thread_id, input, status, started_at)
        VALUES (${turnId}, ${target.id}, 'Queued message', 'running', ${target.createdAt})`);
      tx.run(sql`INSERT INTO outbox (id, kind, payload, next_attempt_at)
        VALUES (${`turn.start:${turnId}`}, 'turn.start', '{}', ${target.createdAt})`);
    });

    const updates = yield* stream;
    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(sentinel.id));
    expect((yield* getThread(target.id)).thread).toMatchObject({ status: "running", doneAt: null });
    expect(db.get(sql`SELECT kind FROM outbox WHERE id = ${`turn.start:${turnId}`}`)).toEqual({ kind: "turn.start" });
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("leaves a manager open while a completed child report is pending", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const manager = yield* newThread(vault.id);
    const child = yield* newThread(vault.id);
    yield* TestClock.adjust(1);
    const sentinel = yield* newThread(vault.id);

    const { db } = yield* Sqlite;
    db.transaction((tx) => {
      tx.run(sql`UPDATE threads SET parent_thread_id = ${manager.id} WHERE id = ${child.id}`);
      tx.run(sql`INSERT INTO turns (id, thread_id, input, status, started_at, ended_at)
        VALUES ('pending-report', ${child.id}, 'Child message', 'completed', ${child.createdAt}, ${child.createdAt})`);
    });

    const updates = yield* stream;
    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(sentinel.id));
    expect((yield* getThread(manager.id)).thread).toMatchObject({ status: "idle", doneAt: null });
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("holds a provider subagent request and observes its follow-up turn before completing", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const target = yield* newThread(vault.id);
    const events = yield* watch(target.id);
    const main = yield* sendOk(target.id, "delegate");
    let mainFinished = false;
    let pending: string | undefined;
    yield* events.until((event) => {
      if (event._tag === "turn.finished" && event.turnId === main) mainFinished = true;
      if (event._tag === "request.opened" && event.subagentId !== undefined) pending = event.requestId;
      return mainFinished && pending !== undefined;
    });
    if (pending === undefined) throw new Error("Replay subagent did not request approval");
    expect((yield* getThread(target.id)).thread).toMatchObject({ status: "waiting", subagentsActive: 1 });

    const sentinel = yield* newThread(vault.id);
    const updates = yield* stream;
    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(sentinel.id));
    expect((yield* getThread(target.id)).thread.doneAt).toBeNull();

    expect((yield* answer(target.id, pending, { _tag: "approval", decision: "approve" })).status).toBe(200);
    yield* events.until(isTag("subagent.reported"));
    yield* events.until((event) => event._tag === "turn.finished" && event.turnId !== main);
    expect((yield* getThread(target.id)).thread).toMatchObject({ status: "idle", subagentsActive: 0, doneAt: null });
    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(target.id));
    expect((yield* configure(false, 30)).status).toBe(200);
  }));

  it.effect("keeps drafts and pending turns open, and restarts the interval after draft removal, resolution or reopen", () => Effect.gen(function* () {
    const vault = yield* newVault;
    const drafted = yield* newThread(vault.id);
    const waiting = yield* newThread(vault.id);
    expect((yield* draft(drafted.id, "Saved thought", 1)).status).toBe(200);
    const turnEvents = yield* watch(waiting.id);
    yield* sendOk(waiting.id, "Ask me a question");
    const requestId = requestIdOf(yield* turnEvents.until(isTag("request.opened")));
    const sentinel = yield* newThread(vault.id);
    const updates = yield* stream;

    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    yield* updates.until(completed(sentinel.id));
    expect((yield* getThread(drafted.id)).thread.doneAt).toBeNull();
    expect((yield* getThread(waiting.id)).thread).toMatchObject({ doneAt: null, status: "waiting" });

    expect((yield* configure(false, 1)).status).toBe(200);
    expect((yield* reopen(sentinel.id)).status).toBe(200);
    expect((yield* draft(drafted.id, "", 2)).status).toBe(200);
    expect((yield* answer(waiting.id, requestId, { _tag: "question", text: "Continue" })).status).toBe(200);
    yield* turnEvents.until(isTag("turn.finished"));
    expect((yield* configure(true, 1)).status).toBe(200);
    for (const id of [drafted.id, waiting.id, sentinel.id]) expect((yield* getThread(id)).thread.doneAt).toBeNull();

    yield* TestClock.adjust(day);
    expect((yield* configure(true, 1)).status).toBe(200);
    const remaining = new Set([drafted.id, waiting.id, sentinel.id]);
    yield* updates.until((frame) => {
      for (const id of remaining) if (completed(id)(frame)) remaining.delete(id);
      return remaining.size === 0;
    });

    yield* sendOk(sentinel.id, "Start again");
    expect((yield* getThread(sentinel.id)).thread).toMatchObject({ doneAt: null, doneReason: null });
    expect((yield* draft(drafted.id, "Reopen by saving work", 3)).status).toBe(200);
    expect((yield* getThread(drafted.id)).thread).toMatchObject({ doneAt: null, doneReason: null });
    expect((yield* configure(false, 30)).status).toBe(200);
  }));
});

const migrationsDir = fileURLToPath(new URL("../../drizzle", import.meta.url));
const appOn = (file: string) => makeHttpApp({
  vaults: [], watch: false, providers: ReplayOnly, agents: TestAgents,
  attachments: TestAttachments, worktrees: TestWorktrees, secrets: TestSecrets,
}).pipe(
  Layer.provideMerge(Layer.effect(Sqlite, makeSqlite({ file, migrationsDir }))),
  Layer.provideMerge(NodeHttpServer.layerTest),
);
const run = <A, E>(file: string, body: Effect.Effect<A, E, Layer.Success<ReturnType<typeof appOn>> | Scope.Scope>) =>
  Effect.scoped(Effect.provide(body, appOn(file)));

const tempData = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "wiki-agents-inactivity-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

it.effect("upgrades older rows conservatively and preserves an existing manual completion", () => Effect.gen(function* () {
  const dir = yield* tempData;
  const file = join(dir, "app.db");
  const legacy = join(dir, "legacy");
  const { root } = yield* makeTestVault({ files: { "index.md": "# Home" } });
  yield* Effect.sync(() => {
    mkdirSync(join(legacy, "meta"), { recursive: true });
    const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    journal.entries = journal.entries.filter(({ idx }) => idx < 29);
    writeFileSync(join(legacy, "meta", "_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries) copyFileSync(join(migrationsDir, `${tag}.sql`), join(legacy, `${tag}.sql`));
  });

  yield* Effect.scoped(Effect.gen(function* () {
    const { db } = yield* makeSqlite({ file, migrationsDir: legacy });
    db.run(sql`INSERT INTO vaults (id, name, root_path, created_at) VALUES ('legacy-vault', 'Legacy', ${root}, 1)`);
    db.run(sql`INSERT INTO threads (id, vault_id, provider_instance_id, created_at, updated_at, done_at)
      VALUES ('old-open', 'legacy-vault', 'replay', 1, 2, NULL),
        ('old-done', 'legacy-vault', 'replay', 1, 2, 2)`);
  }));

  yield* run(file, Effect.gen(function* () {
    expect(yield* getPolicy).toEqual({ policy: { enabled: false, days: 30 } });
    expect((yield* getThread("old-done")).thread).toMatchObject({ doneAt: 2, doneReason: null });
    const { db } = yield* Sqlite;
    const row = db.get<{ activityAt: number }>(sql`SELECT activity_at AS activityAt FROM threads WHERE id = 'old-open'`);
    if (row === undefined) throw new Error("Upgraded thread is missing");
    expect(row.activityAt).toBeGreaterThan(2);

    const updates = yield* (yield* ThreadBus).subscribeThreads;
    yield* TestClock.setTime(row.activityAt + day - 1);
    expect((yield* configure(true, 1)).status).toBe(200);
    expect((yield* getThread("old-open")).thread.doneAt).toBeNull();
    yield* TestClock.adjust(1);
    expect((yield* configure(true, 1)).status).toBe(200);
    let update = yield* PubSub.take(updates);
    while (update.id !== "old-open" || update.doneReason !== "inactivity") update = yield* PubSub.take(updates);
    expect((yield* getThread("old-open")).thread.doneAt).toBe(row.activityAt + day);
  }).pipe(Effect.scoped));
}));

it.effect("catches up on inactivity after restarting over the same database", () => Effect.gen(function* () {
  const dir = yield* tempData;
  const file = join(dir, "app.db");
  const { root } = yield* makeTestVault({ files: { "index.md": "# Home" } });
  const thread = yield* run(file, Effect.gen(function* () {
    const { vault } = yield* post("/api/vaults", { rootPath: root }).pipe(Effect.flatMap(decode(RegisterVaultResponse)));
    const thread = yield* newThread(vault.id);
    expect((yield* configure(true, 1)).status).toBe(200);
    return thread;
  }));

  yield* TestClock.adjust(day);
  yield* run(file, Effect.gen(function* () {
    const updates = yield* (yield* ThreadBus).subscribeThreads;
    if ((yield* getThread(thread.id)).thread.doneAt === null) {
      let threadUpdate = yield* PubSub.take(updates);
      while (threadUpdate.id !== thread.id || threadUpdate.doneReason !== "inactivity") {
        threadUpdate = yield* PubSub.take(updates);
      }
    }
    expect((yield* getThread(thread.id)).thread).toMatchObject({
      doneAt: thread.createdAt + day, doneReason: "inactivity",
    });
  }));
}));
