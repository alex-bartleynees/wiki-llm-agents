import type { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { Effect } from "effect";
import { findThread } from "../find-thread.js";
import { loadContext } from "../note-context.js";
import { ThreadActors } from "../thread-actors.js";
export const sendMessage = Effect.fnUntraced(function* (threadId: string, request: SendMessageRequest) {
  const thread = yield* findThread(threadId);
  const context = yield* Effect.forEach(request.notes ?? [], (note) => loadContext(thread.vaultId, note));
  return yield* (yield* ThreadActors).sendMessage(threadId, request.text, context);
});
