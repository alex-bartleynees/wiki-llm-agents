import { Effect, Option } from "effect";
import { ThreadNotFound } from "./errors.js";
import { ThreadRepository } from "./repository.js";

export const findThread = Effect.fnUntraced(function* (threadId: string) {
  const thread = yield* (yield* ThreadRepository).find(threadId);
  if (Option.isNone(thread)) return yield* new ThreadNotFound({ threadId });
  return thread.value;
});
