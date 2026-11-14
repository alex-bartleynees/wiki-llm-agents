import type { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { Data, Effect } from "effect";
import { AttachmentStore } from "../../attachments/attachment-store.js";
import { findThread } from "../find-thread.js";
import { loadContext } from "../note-context.js";
import { ThreadActors } from "../thread-actors.js";

/** A message with neither text nor attachments. */
export class EmptyMessage extends Data.TaggedError("EmptyMessage") {}

export const sendMessage = Effect.fnUntraced(function* (threadId: string, request: SendMessageRequest) {
  const ids = request.attachments ?? [];
  if (request.text.trim() === "" && ids.length === 0) return yield* new EmptyMessage();
  const thread = yield* findThread(threadId);
  const context = yield* Effect.forEach(request.notes ?? [], (note) => loadContext(thread.vaultId, note));
  const attachments = (yield* (yield* AttachmentStore).find([...new Set(ids)])).map(({ path: _path, ...attachment }) => attachment);
  return yield* (yield* ThreadActors).sendMessage(threadId, request.text, context, attachments.length ? { attachments } : {});
});
