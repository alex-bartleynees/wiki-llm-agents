import { WallClock } from "../../../shared/wall-clock.js";
import type { SaveDraftRequest } from "@wiki-agents/contracts/threads/save-draft/request";
import { Data, Effect } from "effect";
import { findThread } from "../find-thread.js";
import { ThreadBus } from "../thread-bus.js";
import { ThreadRepository } from "../repository.js";

export class DraftConflict extends Data.TaggedError("DraftConflict")<{}> {}

export const saveDraft = Effect.fn("SaveDraft")(function* (request: SaveDraftRequest & { readonly threadId: string }) {
  yield* findThread(request.threadId);
  const repository = yield* ThreadRepository;
  const saved = yield* repository.saveDraft(request.threadId, request, yield* (yield* WallClock).now);
  if (saved === null) return yield* new DraftConflict();
  if (saved.reopened !== undefined) yield* (yield* ThreadBus).publishThread(saved.reopened);
  return { draft: saved.draft };
});
