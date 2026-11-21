import { Cause, Effect } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { ThreadRepository } from "./repository.js";
import { ThreadActors } from "./thread-actors.js";

const hourMs = 60 * 60 * 1000;
const retryMs = 60_000;

export const runInactivityWorker = Effect.gen(function* () {
  const clock = yield* WallClock;
  const repository = yield* ThreadRepository;
  const actors = yield* ThreadActors;

  const sweep = Effect.gen(function* () {
    const policy = yield* repository.inactivityPolicy;
    if (!policy.enabled) return undefined;
    const now = yield* clock.now;
    const cutoff = now - policy.days * 24 * hourMs;
    let after: { readonly at: number; readonly id: string } | undefined;
    let retry = false;
    for (;;) {
      const batch = yield* repository.inactiveCandidates(cutoff, after);
      if (batch.length === 0) return retry ? (yield* clock.now) + retryMs : now + hourMs;
      for (const candidate of batch) {
        yield* actors.completeInactive(candidate.id).pipe(
          Effect.catch((error) => {
            retry = true;
            return Effect.logWarning("Could not check inactive thread", candidate.id, error);
          }),
        );
      }
      after = batch.at(-1);
      yield* Effect.yieldNow;
      const current = yield* repository.inactivityPolicy;
      if (!current.enabled || current.days !== policy.days) return yield* clock.now;
    }
  });

  for (;;) {
    const next = yield* sweep.pipe(Effect.catchCause((cause) => Cause.hasInterruptsOnly(cause)
      ? Effect.failCause(cause)
      : Effect.logWarning("Thread inactivity sweep failed", cause).pipe(Effect.andThen(clock.now), Effect.map((now) => now + retryMs)),
    ));
    yield* next === undefined
      ? repository.inactivityPolicyChanged
      : Effect.raceFirst(repository.inactivityPolicyChanged, clock.sleepUntil(next));
  }
});
