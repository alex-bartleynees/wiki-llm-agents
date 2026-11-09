import type { StoredThreadEvent, ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Context, Effect, Layer, PubSub, type Scope } from "effect";

/**
 * Thread events and thread list changes for SSE connections. Publishers write to
 * SQLite first, so a subscriber that reads the store after subscribing misses nothing.
 */
export interface ThreadBusService {
  readonly publishEvents: (events: ReadonlyArray<StoredThreadEvent>) => Effect.Effect<void>;
  readonly publishThread: (thread: ThreadSummary) => Effect.Effect<void>;
  readonly subscribeEvents: Effect.Effect<PubSub.Subscription<StoredThreadEvent>, never, Scope.Scope>;
  readonly subscribeThreads: Effect.Effect<PubSub.Subscription<ThreadSummary>, never, Scope.Scope>;
}

export class ThreadBus extends Context.Service<ThreadBus, ThreadBusService>()("ThreadBus") {}

export const ThreadBusLive = Layer.effect(
  ThreadBus,
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<StoredThreadEvent>();
    const updates = yield* PubSub.unbounded<ThreadSummary>();
    return ThreadBus.of({
      publishEvents: (stored) => Effect.asVoid(PubSub.publishAll(events, stored)),
      publishThread: (thread) => Effect.asVoid(PubSub.publish(updates, thread)),
      subscribeEvents: PubSub.subscribe(events),
      subscribeThreads: PubSub.subscribe(updates),
    });
  }),
);
