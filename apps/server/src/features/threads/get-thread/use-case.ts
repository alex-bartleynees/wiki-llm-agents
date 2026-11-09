import type { GetThreadRequest } from "@wiki-agents/contracts/threads/get-thread/request";
import type { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { Effect } from "effect";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";

/** Events are read after the summary, so they reach at least `thread.lastSeq`. */
export const getThread = Effect.fn("getThread")(function* (request: GetThreadRequest) {
  const thread = yield* findThread(request.threadId);
  const events = yield* (yield* ThreadRepository).events(thread.id, 0);
  const response: GetThreadResponse = { thread: { ...thread, lastSeq: events.at(-1)?.seq ?? thread.lastSeq }, events };
  return response;
});
