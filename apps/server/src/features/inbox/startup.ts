import { Effect, Layer } from "effect";
import { runDeliveryWorker } from "./delivery-worker.js";
import { watchThreadEvents } from "./thread-events.js";

/** The delivery worker and the thread events that become inbox items, for the server's life. */
export const InboxStartup = Layer.effectDiscard(
  Effect.gen(function* () {
    const followThreads = yield* watchThreadEvents;
    yield* Effect.forkScoped(followThreads);
    yield* Effect.forkScoped(runDeliveryWorker);
  }),
);
