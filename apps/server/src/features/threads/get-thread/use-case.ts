import { createHash } from "node:crypto";
import type { GetThreadRequest } from "@wiki-agents/contracts/threads/get-thread/request";
import type { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import type { ThreadSummary } from "@wiki-agents/contracts/threads/model";
import { Effect } from "effect";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";

export const threadEtag = (thread: ThreadSummary): string => {
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        thread.id,
        thread.lastSeq,
        thread.updatedAt,
        thread.title,
        thread.status,
        thread.model,
        thread.childModelSource,
        thread.agentId,
        thread.doneAt,
        thread.doneReason,
        thread.subagentsActive,
        thread.continuedIn,
        thread.runningTurn,
        thread.lastTurn,
      ]),
    )
    .digest("base64url")
    .slice(0, 24);
  return `"${hash}"`;
};

export const getThreadSummary = (request: GetThreadRequest) => findThread(request.threadId);

export const getThreadWithSummary = Effect.fn("getThreadWithSummary")(function* (thread: ThreadSummary) {
  const events = yield* (yield* ThreadRepository).events(thread.id, 0);
  const response: GetThreadResponse = { thread: { ...thread, lastSeq: events.at(-1)?.seq ?? thread.lastSeq }, events };
  return response;
});

export const getThread = Effect.fn("getThread")(function* (request: GetThreadRequest) {
  const thread = yield* findThread(request.threadId);
  return yield* getThreadWithSummary(thread);
});
