import { ThreadsStreamMessage } from "@wiki-agents/contracts/threads/event";
import { Effect, Schema, Stream } from "effect";
import { sseFrame } from "../../../shared/sse.js";
import { ThreadBus } from "../thread-bus.js";

const encode = Schema.encodeSync(Schema.fromJsonString(ThreadsStreamMessage));

/** Changes to every thread in every vault (new, renamed, status, progress) as SSE frames. */
export const streamAllThreads = Effect.fn("streamAllThreads")(function* () {
  const bus = yield* ThreadBus;
  return Stream.unwrap(
    Effect.map(bus.subscribeThreads, (subscription) =>
      Stream.concat(
        Stream.succeed<ThreadsStreamMessage>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.map((thread): ThreadsStreamMessage => ({ type: "thread.updated", thread }))),
      ),
    ),
  ).pipe(Stream.map((message) => sseFrame(encode(message))));
});
