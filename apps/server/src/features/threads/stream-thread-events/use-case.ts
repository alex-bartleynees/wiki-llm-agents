import type { ThreadStreamMessage } from "@wiki-agents/contracts/threads/event";
import { Effect, Stream } from "effect";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";
import { ThreadBus } from "../thread-bus.js";

/**
 * The `thread` topic: the thread's events after `after`: `ready`, then stored ones, then live ones.
 * Subscribes before reading the store, and skips live events it already sent, so
 * nothing falls in the gap between the two and nothing is sent twice.
 */
export const streamThreadEvents = Effect.fn("streamThreadEvents")(function* (request: { readonly threadId: string; readonly after: number }) {
  const thread = yield* findThread(request.threadId);
  const repository = yield* ThreadRepository;
  const bus = yield* ThreadBus;
  const { after } = request;
  return Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* bus.subscribeEvents;
      const stored = yield* repository.events(thread.id, after).pipe(Effect.orDie);
      const sent = stored.at(-1)?.seq ?? after;
      const live = Stream.fromSubscription(subscription).pipe(Stream.filter((event) => event.threadId === thread.id && event.seq > sent));
      return Stream.concat(Stream.fromIterable(stored), live).pipe(
        Stream.map((event): ThreadStreamMessage => ({ type: "event", event })),
        Stream.prepend<ThreadStreamMessage>([{ type: "ready" }]),
      );
    }),
  );
});
