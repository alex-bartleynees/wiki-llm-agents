import type { MarkReadRequest } from "@wiki-agents/contracts/inbox/mark-read/request";
import { Effect } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { Inbox } from "../inbox.js";
import { InboxRepository } from "../repository.js";

/** Marks the items read and tells other open browsers, so every badge agrees. */
export const markRead = Effect.fnUntraced(function* (request: MarkReadRequest) {
  const items = yield* (yield* InboxRepository).markRead(request.itemIds, yield* (yield* WallClock).now);
  yield* (yield* Inbox).publish(items);
  return items;
});
