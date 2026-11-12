import { Effect, Layer } from "effect";
import { runScheduler, watchRuns } from "./scheduler.js";

/**
 * Follows scheduled runs' turns, then starts the scheduler, which first catches up
 * on anything that came due while the server was off.
 */
export const SchedulesStartup = Layer.effectDiscard(
  Effect.gen(function* () {
    const followRuns = yield* watchRuns;
    yield* Effect.forkScoped(followRuns);
    yield* Effect.forkScoped(runScheduler);
  }),
);
