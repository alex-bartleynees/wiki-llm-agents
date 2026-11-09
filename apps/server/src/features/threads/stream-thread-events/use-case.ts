import { ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import type { StreamThreadEventsRequest } from "@wiki-agents/contracts/threads/stream-thread-events/request";
import { Effect, Schema, Stream } from "effect";
import { sseFrame } from "../../../shared/sse.js";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";
import { ThreadBus } from "../thread-bus.js";

const encode = Schema.encodeSync(Schema.fromJsonString(ThreadStreamMessage));

/**
 * The thread's events after `after` as SSE frames: stored ones, then live ones.
 * Subscribes before reading the store, and skips live events it already sent, so
 * nothing falls in the gap between the two and nothing is sent twice.
 */
export const streamThreadEvents = Effect.fn("streamThreadEvents")(function* (request: StreamThreadEventsRequest) {
  const thread = yield* findThread(request.threadId);
  const repository = yield* ThreadRepository;
  const bus = yield* ThreadBus;
  const after = request.after ?? 0;
  return Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* bus.subscribeEvents;
      const stored = yield* repository.events(thread.id, after).pipe(Effect.orDie);
      const sent = stored.at(-1)?.seq ?? after;
      const live = Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.threadId === thread.id && event.seq > sent));
      return Stream.concat(Stream.fromIterable(stored), live).pipe(
        Stream.map((event) => sseFrame(encode({ type: "event", event }), event.seq)),
        Stream.prepend([sseFrame(encode({ type: "ready" }))]),
      );
    }),
  );
});
