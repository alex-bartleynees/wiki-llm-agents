import { randomUUID } from "node:crypto";
import type { EventStreamFrame } from "@wiki-agents/contracts/events/event";
import { Cause, Context, Data, Deferred, Effect, FiberMap, Layer, Queue, type Scope, Stream } from "effect";

export class ConnectionNotFound extends Data.TaggedError("ConnectionNotFound")<{ readonly connectionId: string }> {}

/** One open `GET /events` stream: what it still has to send, and its subscriptions' fibers. */
interface Connection {
  readonly frames: Queue.Queue<EventStreamFrame>;
  readonly subscriptions: FiberMap.FiberMap<string, void>;
}

export interface EventConnectionsService {
  /**
   * Opens a connection: its frames, starting with `connected`. It lasts as long as the
   * scope; closing that stops its subscriptions and forgets it.
   */
  readonly open: Effect.Effect<Stream.Stream<EventStreamFrame>, never, Scope.Scope>;
  /**
   * Sends `messages` (already encoded with their topic's schema) on the connection as
   * `subscriptionId`, replacing a subscription with that id. Returns once the first
   * message is queued (every topic starts with `ready`, once it is subscribed), or the
   * messages ended without one.
   */
  readonly subscribe: (
    connectionId: string,
    subscriptionId: string,
    messages: Stream.Stream<unknown>,
  ) => Effect.Effect<void, ConnectionNotFound>;
  /** Stops a subscription; one that already ended is fine. */
  readonly unsubscribe: (connectionId: string, subscriptionId: string) => Effect.Effect<void, ConnectionNotFound>;
}

/**
 * The open event streams, one per browser tab. Each carries any number of topics, so
 * a tab holds one of the browser's six HTTP/1.1 connections per host.
 */
export class EventConnections extends Context.Service<EventConnections, EventConnectionsService>()("EventConnections") {}

export const EventConnectionsLive = Layer.sync(EventConnections, () => {
  const connections = new Map<string, Connection>();

  const find = (connectionId: string) =>
    Effect.suspend(() => {
      const connection = connections.get(connectionId);
      return connection === undefined ? Effect.fail(new ConnectionNotFound({ connectionId })) : Effect.succeed(connection);
    });

  return EventConnections.of({
    open: Effect.gen(function* () {
      const connectionId = randomUUID();
      const frames = yield* Queue.unbounded<EventStreamFrame>();
      // Closing the scope interrupts every subscription.
      const subscriptions = yield* FiberMap.make<string, void>();
      yield* Effect.acquireRelease(
        Effect.sync(() => connections.set(connectionId, { frames, subscriptions })),
        () => Effect.andThen(Effect.sync(() => connections.delete(connectionId)), Queue.shutdown(frames)),
      );
      return Stream.concat(Stream.succeed<EventStreamFrame>({ type: "connected", connectionId }), Stream.fromQueue(frames));
    }),

    subscribe: Effect.fn("EventConnections.subscribe")(function* (connectionId, subscriptionId, messages) {
      const connection = yield* find(connectionId);
      const started = yield* Deferred.make<void>();
      yield* FiberMap.run(
        connection.subscriptions,
        subscriptionId,
        messages.pipe(
          Stream.runForEach((message) =>
            Effect.andThen(Queue.offer(connection.frames, { type: "message", subscriptionId, message }), Deferred.succeed(started, undefined)),
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError("event subscription failed", cause),
          ),
          Effect.ensuring(Deferred.succeed(started, undefined)),
        ),
      );
      yield* Deferred.await(started);
    }),

    unsubscribe: (connectionId, subscriptionId) =>
      Effect.flatMap(find(connectionId), (connection) => FiberMap.remove(connection.subscriptions, subscriptionId)),
  });
});
