import { type Duration, Effect, FiberMap } from "effect";

/**
 * Runs an effect once a key has been quiet for `delay`: each call for the same key
 * cancels the pending one. Editors and Syncthing write a file several times in a
 * burst; this turns that into one index update.
 */
export const makeDebouncer = (delay: Duration.Input) =>
  Effect.gen(function* () {
    const pending = yield* FiberMap.make<string>();
    return (key: string, effect: Effect.Effect<void>) =>
      Effect.asVoid(FiberMap.run(pending, key, Effect.andThen(Effect.sleep(delay), effect)));
  });
