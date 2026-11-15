import type { GetDraftRequest } from "@wiki-agents/contracts/threads/get-draft/request";
import { Effect } from "effect";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";

export const getDraft = Effect.fn("GetDraft")(function* (request: GetDraftRequest) {
  yield* findThread(request.threadId);
  const repository = yield* ThreadRepository;
  const draft = yield* repository.draft(request.threadId);
  return { draft };
});
