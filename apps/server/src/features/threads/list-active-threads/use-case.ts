import { STOPPED_SHOWN_FOR, threadActivity } from "@wiki-agents/contracts/threads/model";
import { Clock, Effect } from "effect";
import { ThreadRepository } from "../repository.js";

/** Threads working, waiting for you, or stopped, in every vault: the running view. */
export const listActiveThreads = Effect.fn("listActiveThreads")(function* () {
  const now = yield* Clock.currentTimeMillis;
  const threads = yield* (yield* ThreadRepository).listActive(now - STOPPED_SHOWN_FOR);
  return threads.filter((thread) => threadActivity(thread, now) !== null);
});
