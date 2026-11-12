import type { InboxItem } from "@wiki-agents/contracts/inbox/model";
import { Context, Effect, Layer, Queue } from "effect";
import type { DbError } from "../../shared/persistence/errors.js";
import { WallClock } from "../../shared/wall-clock.js";
import { DeliveryChannels } from "./delivery.js";
import { InboxBus } from "./inbox-bus.js";
import { InboxRepository, type NewInboxItem } from "./repository.js";

/**
 * The inbox as other features use it: add an item (its deliveries are queued and the
 * delivery worker woken), or tell the worker about items queued in their own
 * transaction (`inbox/rows.ts`).
 */
export interface InboxService {
  /** The channel ids every item is queued on. */
  readonly channels: ReadonlyArray<string>;
  readonly add: (item: NewInboxItem) => Effect.Effect<InboxItem, DbError>;
  /** Deliveries were queued: send any that are due. */
  readonly wake: Effect.Effect<void>;
  /** Items changed in ways that aren't deliveries (read, done...): tell open browsers. */
  readonly publish: (items: ReadonlyArray<InboxItem>) => Effect.Effect<void>;
  /** Returns at the next `wake`; for the delivery worker. */
  readonly woken: Effect.Effect<void>;
}

export class Inbox extends Context.Service<Inbox, InboxService>()("Inbox") {}

export const InboxLive = Layer.effect(
  Inbox,
  Effect.gen(function* () {
    const repository = yield* InboxRepository;
    const bus = yield* InboxBus;
    const clock = yield* WallClock;
    const channels = (yield* DeliveryChannels).map((channel) => channel.id);
    // One pending wake is enough: the worker reads everything due when it wakes.
    const wakes = yield* Queue.sliding<void>(1);
    const wake = Effect.asVoid(Queue.offer(wakes, undefined));
    return Inbox.of({
      channels,
      add: (item) => Effect.tap(Effect.flatMap(clock.now, (at) => repository.add(item, channels, at)), () => wake),
      wake,
      publish: bus.publish,
      woken: Queue.take(wakes),
    });
  }),
);
