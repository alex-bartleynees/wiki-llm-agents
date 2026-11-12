import type { Recurrence } from "@wiki-agents/contracts/schedules/model";
import { Cause, Context, Effect, Layer, Option, Queue } from "effect";
import { AppConfig } from "../../shared/config.js";
import { latestDue, nextSlot } from "../../shared/time/recurrence.js";
import { WallClock } from "../../shared/wall-clock.js";
import { Inbox } from "../inbox/inbox.js";
import { NotificationsRepository } from "./repository.js";
import { digestItem } from "./routing.js";

/** Tells the digest that an item was held or the preferences changed, so it looks again at when it is due. */
export class DigestSignal extends Context.Service<DigestSignal, { readonly wake: Effect.Effect<void>; readonly woken: Effect.Effect<void> }>()(
  "DigestSignal",
) {}

export const DigestSignalLive = Layer.effect(
  DigestSignal,
  Effect.gen(function* () {
    const wakes = yield* Queue.sliding<void>(1);
    return DigestSignal.of({ wake: Effect.asVoid(Queue.offer(wakes, undefined)), woken: Queue.take(wakes) });
  }),
);

const DAY = 86_400_000;
const ERROR_PAUSE = 5000;

/** The latest digest time at or before `now`. */
export const latestDigestAt = (recurrence: Recurrence, timeZone: string, now: number) => {
  const first = nextSlot(recurrence, timeZone, now - 2 * DAY);
  if (first === null || first > now) return null;
  return latestDue(recurrence, timeZone, first, now).latest;
};

/**
 * The morning digest: at the digest time, the items held since the last one (and
 * still open) become one `digest` inbox item, which goes out like any other. Items
 * held while the app was off at digest time go out at startup.
 */
export const runDigest = Effect.gen(function* () {
  const repository = yield* NotificationsRepository;
  const inbox = yield* Inbox;
  const clock = yield* WallClock;
  const signal = yield* DigestSignal;
  const timeZone = yield* AppConfig.timezone;

  const round = Effect.gen(function* () {
    const now = yield* clock.now;
    const { digestTime } = yield* repository.preferences;
    const recurrence: Recurrence = { _tag: "daily", time: digestTime };
    const due = latestDigestAt(recurrence, timeZone, now);
    const oldest = yield* repository.oldestHeldAt;
    if (due !== null && oldest !== null && oldest < due) {
      const digest = yield* repository.takeDigest(due, digestItem, inbox.channels, now);
      if (Option.isSome(digest)) yield* inbox.wake;
    }
    // Nothing held: nothing to wake for until something is (`hold` wakes it).
    const held = (yield* repository.oldestHeldAt) !== null;
    const next = held ? nextSlot(recurrence, timeZone, now) : null;
    yield* next === null ? signal.woken : Effect.raceFirst(signal.woken, clock.sleepUntil(next));
  });

  return yield* round.pipe(
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.andThen(
            Effect.logError("notification digest failed", cause),
            Effect.raceFirst(signal.woken, Effect.flatMap(clock.now, (now) => clock.sleepUntil(now + ERROR_PAUSE))),
          ),
    ),
    Effect.forever,
  );
});
