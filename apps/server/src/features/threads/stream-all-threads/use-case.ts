import type { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import { Effect, Stream } from "effect";
import { ThreadBus } from "../thread-bus.js";

/** The `all-threads` topic: changes to every thread in every vault (new, renamed, status, progress); `ready` once subscribed. */
export const streamAllThreads = Effect.fn("streamAllThreads")(function* () {
  const bus = yield* ThreadBus;
  return Stream.unwrap(
    Effect.map(bus.subscribeThreads, (subscription) =>
      Stream.concat(
        Stream.succeed<ThreadsStreamMessage>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.map((thread): ThreadsStreamMessage => ({ type: "thread.updated", thread }))),
      ),
    ),
  );
});
