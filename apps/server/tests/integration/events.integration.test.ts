import { expect, layer } from "@effect/vitest";
import { SubscribeResponse } from "@wiki-agents/contracts/events/subscribe/response";
import { UnsubscribeResponse } from "@wiki-agents/contracts/events/unsubscribe/response";
import { ThreadsStreamMessage, ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import { Effect, Fiber, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { type Delivered, openEvents } from "./infrastructure/events.js";
import { TestApp } from "./infrastructure/test-app.js";
import { answer, decode, getThread, isTag, newThread, newVault, post, requestIdOf, sendOk, watch } from "./infrastructure/threads.js";

const threadMessage = Schema.decodeUnknownSync(ThreadStreamMessage);
const threadsMessage = Schema.decodeUnknownSync(ThreadsStreamMessage);

/** The thread ids in `thread.updated` messages on a subscription. */
const updatedThreads = (delivered: ReadonlyArray<Delivered>, subscriptionId: string) =>
  delivered.flatMap((frame) => {
    if (frame.subscriptionId !== subscriptionId) return [];
    const message = threadsMessage(frame.message);
    return message.type === "thread.updated" ? [message.thread.id] : [];
  });

/** The seqs of thread events on a subscription. */
const seqs = (delivered: ReadonlyArray<Delivered>, subscriptionId: string) =>
  delivered.flatMap((frame) => {
    if (frame.subscriptionId !== subscriptionId) return [];
    const message = threadMessage(frame.message);
    return message.type === "event" ? [message.event.seq] : [];
  });

const isUpdateOf = (subscriptionId: string, threadId: string) => (frame: Delivered) =>
  frame.subscriptionId === subscriptionId && updatedThreads([frame], subscriptionId).includes(threadId);

layer(TestApp)("one event stream per tab", (it) => {
  it.effect("carries several topics on one connection, each starting with `ready`", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const events = yield* openEvents;
      expect(events.contentType).toBe("text/event-stream");
      const answered = yield* events.subscribe("inbox", { type: "inbox" }).pipe(Effect.flatMap(decode(SubscribeResponse)));
      expect(answered).toEqual({ subscriptionId: "inbox" });
      yield* events.subscribe("vault", { type: "vault", vaultId: vault.id }).pipe(Effect.flatMap(decode(SubscribeResponse)));
      yield* events.subscribe("list", { type: "vault-threads", vaultId: vault.id }).pipe(Effect.flatMap(decode(SubscribeResponse)));
      yield* events.subscribe("all", { type: "all-threads" }).pipe(Effect.flatMap(decode(SubscribeResponse)));
      // Each subscription's `ready` was queued before its POST answered.
      expect(yield* events.until((frame) => frame.subscriptionId === "all")).toEqual([
        { type: "message", subscriptionId: "inbox", message: { type: "ready" } },
        { type: "message", subscriptionId: "vault", message: { type: "ready" } },
        { type: "message", subscriptionId: "list", message: { type: "ready" } },
        { type: "message", subscriptionId: "all", message: { type: "ready" } },
      ]);

      const thread = yield* newThread(vault.id);
      const seen = [...(yield* events.until(isUpdateOf("list", thread.id)))];
      if (!seen.some(isUpdateOf("all", thread.id))) seen.push(...(yield* events.until(isUpdateOf("all", thread.id))));
      expect(updatedThreads(seen, "list")).toContain(thread.id);
      expect(updatedThreads(seen, "all")).toContain(thread.id);
    }),
  );

  it.effect("stops an unsubscribed topic while the others go on", () =>
    Effect.gen(function* () {
      const vault = yield* newVault;
      const events = yield* openEvents;
      yield* events.subscribe("list", { type: "vault-threads", vaultId: vault.id });
      yield* events.subscribe("all", { type: "all-threads" });
      yield* events.until((frame) => frame.subscriptionId === "all");
      expect(yield* events.unsubscribe("list").pipe(Effect.flatMap(decode(UnsubscribeResponse)))).toEqual({ subscriptionId: "list" });
      // A subscription that already ended is fine.
      expect((yield* events.unsubscribe("list")).status).toBe(200);

      // The DELETE answered once the subscription had stopped, so nothing more comes from it.
      const thread = yield* newThread(vault.id);
      const seen = yield* events.until(isUpdateOf("all", thread.id));
      expect(seen.filter((frame) => frame.subscriptionId === "list")).toEqual([]);
    }),
  );

  it.effect("replays a thread's events after a seq, then continues live without gaps or repeats", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const watched = yield* watch(thread.id);
      yield* sendOk(thread.id, "edit the plan");
      const requestId = requestIdOf(yield* watched.until(isTag("request.opened")));

      const events = yield* openEvents;
      yield* events.subscribe("thread", { type: "thread", threadId: thread.id, after: 2 });
      const finished = (frame: Delivered) => {
        const message = threadMessage(frame.message);
        return message.type === "event" && message.event.event._tag === "turn.finished";
      };
      const reader = yield* Effect.forkChild(events.until(finished));
      yield* answer(thread.id, requestId, { _tag: "approval", decision: "approve" });
      yield* watched.until(isTag("turn.finished"));
      const delivered = yield* Fiber.join(reader);
      const { thread: done } = yield* getThread(thread.id);
      expect(threadMessage(delivered[0]?.message)).toEqual({ type: "ready" });
      expect(seqs(delivered, "thread")).toEqual(Array.from({ length: done.lastSeq - 2 }, (_, index) => index + 3));
    }),
  );

  it.effect("replays all of a finished thread's stored events from 0, or the rest from a later seq", () =>
    Effect.gen(function* () {
      const thread = yield* newThread((yield* newVault).id);
      const watched = yield* watch(thread.id);
      yield* sendOk(thread.id, "hello");
      yield* watched.until(isTag("turn.finished"));
      const { thread: done } = yield* getThread(thread.id);
      const last = (subscriptionId: string) => (frame: Delivered) => {
        if (frame.subscriptionId !== subscriptionId) return false;
        const message = threadMessage(frame.message);
        return message.type === "event" && message.event.seq === done.lastSeq;
      };

      const events = yield* openEvents;
      yield* events.subscribe("all", { type: "thread", threadId: thread.id, after: 0 });
      const all = yield* events.until(last("all"));
      expect(threadMessage(all[0]?.message)).toEqual({ type: "ready" });
      expect(seqs(all, "all")).toEqual(Array.from({ length: done.lastSeq }, (_, index) => index + 1));
      yield* events.subscribe("rest", { type: "thread", threadId: thread.id, after: 3 });
      expect(seqs(yield* events.until(last("rest")), "rest")).toEqual(seqs(all, "all").slice(3));
    }),
  );

  it.effect("rejects unknown connections, vaults and threads, and invalid topics", () =>
    Effect.gen(function* () {
      const events = yield* openEvents;
      expect((yield* events.subscribe("v", { type: "vault", vaultId: "nope" })).status).toBe(404);
      expect((yield* events.subscribe("t", { type: "thread", threadId: "nope", after: 0 })).status).toBe(404);
      expect((yield* post(`/api/events/${events.connectionId}/subscriptions`, { subscriptionId: "x", topic: { type: "weather" } })).status).toBe(400);
      expect((yield* events.subscribe("", { type: "inbox" })).status).toBe(400);
      expect((yield* post(`/api/events/${events.connectionId}/subscriptions`, { subscriptionId: "t", topic: { type: "thread", threadId: "nope", after: -1 } })).status).toBe(400);

      expect((yield* post("/api/events/missing/subscriptions", { subscriptionId: "i", topic: { type: "inbox" } })).status).toBe(404);
      const unknown = yield* HttpClient.execute(HttpClientRequest.delete("/api/events/missing/subscriptions/i"));
      expect(unknown.status).toBe(404);
      expect(yield* HttpClientResponse.filterStatusOk(unknown).pipe(Effect.flip, Effect.map((error) => error._tag))).toBe("HttpClientError");
    }),
  );
});
