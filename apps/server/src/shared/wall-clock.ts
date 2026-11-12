import { Clock, Context, Effect, Layer, PubSub, Ref } from "effect";

/**
 * The time schedules and inbox deliveries are due by: Effect's `Clock` (so tests
 * drive it with `TestClock`), plus an offset that only the end-to-end test hook
 * moves (`POST /api/test/clock`), so a browser test can make a schedule fire
 * without sleeping. Moving it wakes everything waiting on `sleepUntil`.
 */
export interface WallClockService {
  readonly now: Effect.Effect<number>;
  /** Returns once `now` has reached `at` (at once if it already has). */
  readonly sleepUntil: (at: number) => Effect.Effect<void>;
  /** Moves the clock forward; for the test hook only. */
  readonly advance: (ms: number) => Effect.Effect<void>;
}

export class WallClock extends Context.Service<WallClock, WallClockService>()("WallClock") {}

export const WallClockLive = Layer.effect(
  WallClock,
  Effect.gen(function* () {
    const offset = yield* Ref.make(0);
    const moved = yield* PubSub.unbounded<void>();
    const now = Effect.zipWith(Clock.currentTimeMillis, Ref.get(offset), (time, shift) => time + shift);
    return WallClock.of({
      now,
      sleepUntil: (at) =>
        Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(moved);
            for (let current = yield* now; current < at; current = yield* now) {
              yield* Effect.raceFirst(Effect.sleep(at - current), PubSub.take(subscription));
            }
          }),
        ),
      advance: (ms) => Effect.andThen(Ref.update(offset, (shift) => shift + ms), PubSub.publish(moved, undefined)),
    });
  }),
);
