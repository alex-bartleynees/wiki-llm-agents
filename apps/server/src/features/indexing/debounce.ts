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

/**
 * Collects paths for a vault in a fixed window. Unlike a trailing debounce, a
 * continuous sync still makes progress, and a burst produces one index command.
 */
export const makePathBatcher = (delay: Duration.Input) =>
  Effect.gen(function* () {
    const schedule = yield* makeDebouncer(delay);
    const pending = new Map<string, Set<string>>();
    return (key: string, path: string, flush: (paths: ReadonlyArray<string>) => Effect.Effect<void>) =>
      Effect.gen(function* () {
        const existing = pending.get(key);
        if (existing) {
          existing.add(path);
          return;
        }
        const paths = new Set([path]);
        pending.set(key, paths);
        yield* schedule(key, Effect.suspend(() => {
          pending.delete(key);
          return flush([...paths]);
        }));
      });
  });
