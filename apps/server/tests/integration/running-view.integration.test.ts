import { expect, layer } from "@effect/vitest";
import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import { ListActiveThreadsResponse } from "@wiki-agents/contracts/threads/list-active-threads/response";
import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Effect, Schema } from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { type Delivered, openEvents } from "./infrastructure/events.js";
import { TestApp } from "./infrastructure/test-app.js";
import { answer, decode, getThread, interrupt, isTag, markDone, newThread, newVault, requestIdOf, sendOk, watch } from "./infrastructure/threads.js";

const activeThreads = HttpClient.get("/api/active-threads").pipe(
  Effect.flatMap(decode(ListActiveThreadsResponse)),
  Effect.map((response) => response.threads),
);
const activeIds = Effect.map(activeThreads, (threads) => threads.map((thread) => thread.id));

/** Runs a replay turn to its end. */
const runTurn = (threadId: string, text: string) =>
  Effect.gen(function* () {
    const events = yield* watch(threadId);
    yield* sendOk(threadId, text);
    return yield* events.until(isTag("turn.finished"));
  });

layer(TestApp)("running view", (it) => {
  it.effect("reports the turn's plan as progress while it runs, and clears it when the turn ends", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const events = yield* watch(thread.id);
      const turnId = yield* sendOk(thread.id, "make a plan and follow it");
      const seen = yield* events.until(isTag("request.opened"));
      expect(seen.filter(isTag("plan.updated"))).toHaveLength(2);
      expect(seen.filter(isTag("tool.called")).map((event) => (event._tag === "tool.called" ? event.name : ""))).toEqual(["read"]);

      const { thread: waiting, events: stored } = yield* getThread(thread.id);
      expect(waiting.status).toBe("waiting");
      expect(waiting.runningTurn).toEqual({
        startedAt: expect.any(Number),
        progress: { done: 1, total: 3, current: "Draft a summary" },
      });
      expect(stored.findLast((event) => event.event._tag === "plan.updated")?.event).toMatchObject({ turnId, steps: expect.any(Array) });
      expect(yield* activeThreads).toContainEqual(expect.objectContaining({ id: thread.id, status: "waiting" }));

      yield* answer(thread.id, requestIdOf(seen), { _tag: "question", text: "_Inbox" });
      yield* events.until(isTag("turn.finished"));
      const { thread: after } = yield* getThread(thread.id);
      expect(after).toMatchObject({ status: "idle", runningTurn: null, lastTurn: { outcome: "completed", reason: null } });
      expect(yield* activeIds).not.toContain(thread.id);
    }),
  );

  it.effect("keeps a failed thread until you mark it done, and leaves out ones you stopped or that finished", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const failed = yield* newThread(vault.id);
      const finished = yield* newThread(vault.id);
      const stopped = yield* newThread(vault.id);
      yield* runTurn(failed.id, "this will fail");
      yield* runTurn(finished.id, "hello");
      const events = yield* watch(stopped.id);
      yield* sendOk(stopped.id, "a long essay please");
      yield* events.until(isTag("message.delta"), "100 millis");
      yield* interrupt(stopped.id);

      const listed = yield* activeThreads;
      expect(listed.map((thread) => thread.id)).toEqual([failed.id]);
      expect(listed[0]!.lastTurn).toMatchObject({ outcome: "failed", reason: "The provider stopped with an error (recorded)." });
      expect((yield* getThread(stopped.id)).thread.lastTurn).toMatchObject({ outcome: "interrupted", reason: null });

      yield* markDone(failed.id);
      expect(yield* activeIds).toEqual([]);
    }),
  );

  it.effect("drops a failed thread after a week", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      yield* runTurn(thread.id, "this will fail");
      expect(yield* activeIds).toContain(thread.id);
      yield* TestClock.adjust("8 days");
      expect(yield* activeIds).not.toContain(thread.id);
    }),
  );

  it.effect("streams thread changes from every vault on the all-threads topic", () =>
    Effect.gen(function* () {
      const first = yield* newThread((yield* newVault).id);
      const second = yield* newThread((yield* newVault).id);
      const decodeMessage = Schema.decodeUnknownSync(ThreadsStreamMessage);
      const updated = (frame: Delivered): ReadonlyArray<ThreadSummary> => {
        const message = decodeMessage(frame.message);
        return message.type === "thread.updated" ? [message.thread] : [];
      };
      const progressed = (thread: ThreadSummary) => thread.id === second.id && thread.runningTurn?.progress != null;
      const stream = yield* openEvents;
      // Answers once `ready` is queued, so no update below can be missed.
      yield* stream.subscribe("all", { type: "all-threads" });
      yield* runTurn(first.id, "hello");
      const events = yield* watch(second.id);
      yield* sendOk(second.id, "make a plan");
      yield* events.until(isTag("request.opened"));
      const threads = (yield* stream.until((frame) => updated(frame).some(progressed))).flatMap(updated);
      expect(new Set(threads.map((thread) => thread.vaultId))).toEqual(new Set([first.vaultId, second.vaultId]));
      expect(threads.at(-1)?.runningTurn?.progress).toEqual({ done: 0, total: 3, current: "Read the project notes" });
    }),
  );
});
