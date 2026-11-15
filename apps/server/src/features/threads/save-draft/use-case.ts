import type { SaveDraftRequest } from "@wiki-agents/contracts/threads/save-draft/request";
import { Data, Effect } from "effect";
import { findThread } from "../find-thread.js";
import { ThreadRepository } from "../repository.js";

export class DraftConflict extends Data.TaggedError("DraftConflict")<{}> {}

export const saveDraft = Effect.fn("SaveDraft")(function* (request: SaveDraftRequest & { readonly threadId: string }) {
  yield* findThread(request.threadId);
  const repository = yield* ThreadRepository;
  const draft = yield* repository.saveDraft(request.threadId, request);
  if (draft === null) return yield* new DraftConflict();
  return { draft };
});
