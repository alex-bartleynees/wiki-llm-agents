import { Effect, Layer } from "effect";
import { runInactivityWorker } from "./inactivity-worker.js";
import { ThreadRepository } from "./repository.js";
import { ThreadActors } from "./thread-actors.js";

/**
 * At startup, wake every thread whose turn was still running when the server
 * stopped: its actor starts a turn that never reached the provider, resumes one
 * waiting on a request, or closes it as interrupted. In the background, like indexing.
 */
export const ThreadsStartup = Layer.effectDiscard(
  Effect.gen(function* () {
    const actors = yield* ThreadActors;
    const repository = yield* ThreadRepository;
    const threadIds = yield* repository.withOpenTurns;
    const managers = yield* repository.withChildren;
    yield* Effect.forEach(
      threadIds,
      (threadId) => actors.wake(threadId).pipe(Effect.catch((error) => Effect.logWarning(`can't resume thread ${threadId}`, error))),
      { discard: true },
    ).pipe(Effect.andThen(Effect.forEach(
      managers,
      (threadId) => actors.childReports(threadId).pipe(Effect.catch((error) => Effect.logWarning(`can't recover reports for thread ${threadId}`, error))),
      { discard: true },
    )), Effect.andThen(runInactivityWorker), Effect.forkScoped);
  }),
);
