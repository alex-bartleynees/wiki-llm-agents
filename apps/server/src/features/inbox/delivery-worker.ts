import { Cause, Effect, Option } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { DeliveryChannels } from "./delivery.js";
import { Inbox } from "./inbox.js";
import { InboxBus } from "./inbox-bus.js";
import { type DueDelivery, InboxRepository } from "./repository.js";

/** Tries per delivery before it is marked failed. */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** How long the worker waits after its own failure (the database, say) before trying again. */
const ERROR_PAUSE = 5000;

/** Wait before the next try: 1, 2, 4, 8 seconds. */
export const retryDelay = (attempts: number) => 1000 * 2 ** attempts;

/**
 * Sends queued deliveries when they are due (now, or when a snooze ends), retrying
 * failures with backoff and marking them failed after the last try. Runs for the
 * server's life; the outbox is in SQLite, so a restart picks up where it stopped.
 */
export const runDeliveryWorker = Effect.gen(function* () {
  const repository = yield* InboxRepository;
  const channels = yield* DeliveryChannels;
  const inbox = yield* Inbox;
  const bus = yield* InboxBus;
  const clock = yield* WallClock;

  const attempt = Effect.fnUntraced(function* (delivery: DueDelivery) {
    const now = yield* clock.now;
    const item = yield* repository.beginDelivery(delivery.itemId, now);
    const channel = channels.find((candidate) => candidate.id === delivery.channel);
    if (Option.isNone(item) || channel === undefined) {
      return yield* repository.deliveryFailed(delivery.itemId, delivery.channel, Option.isNone(item) ? "The item is gone." : "No such channel.", null);
    }
    const result = yield* Effect.result(channel.deliver(item.value));
    if (result._tag === "Success") return yield* repository.deliverySent(delivery.itemId, delivery.channel, yield* clock.now);
    const tries = delivery.attempts + 1;
    const retryAt = tries >= MAX_DELIVERY_ATTEMPTS ? null : now + retryDelay(delivery.attempts);
    yield* repository.deliveryFailed(delivery.itemId, delivery.channel, result.failure.message, retryAt);
    if (retryAt === null) {
      const failed = yield* repository.find(delivery.itemId);
      if (Option.isSome(failed)) yield* bus.publish([failed.value]);
    }
  });

  const round = Effect.gen(function* () {
    const due = yield* repository.dueDeliveries(yield* clock.now);
    yield* Effect.forEach(due, attempt, { discard: true });
    const next = yield* repository.nextDeliveryAt;
    yield* next === null ? inbox.woken : Effect.raceFirst(inbox.woken, clock.sleepUntil(next));
  });

  return yield* round.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.andThen(
            Effect.logError("inbox delivery failed", cause),
            Effect.raceFirst(inbox.woken, Effect.flatMap(clock.now, (now) => clock.sleepUntil(now + ERROR_PAUSE))),
          ),
    ),
    Effect.forever,
  );
});
