import { Effect, Layer } from "effect";
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
    const threadIds = yield* (yield* ThreadRepository).withOpenTurns;
    yield* Effect.forEach(
      threadIds,
      (threadId) => actors.wake(threadId).pipe(Effect.catch((error) => Effect.logWarning(`can't resume thread ${threadId}`, error))),
      { discard: true },
    ).pipe(Effect.forkScoped);
  }),
);
