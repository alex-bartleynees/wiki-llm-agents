import type { SnoozeItemRequest } from "@wiki-agents/contracts/inbox/snooze-item/request";
import { Effect, Option } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { InboxItemNotFound, InvalidSnooze } from "../errors.js";
import { Inbox } from "../inbox.js";
import { InboxRepository } from "../repository.js";

/** Hides the item until `until`; its delivery is queued for then, so it comes back unread on every channel. */
export const snoozeItem = Effect.fnUntraced(function* (itemId: string, request: SnoozeItemRequest) {
  const now = yield* (yield* WallClock).now;
  if (request.until <= now) return yield* new InvalidSnooze({ message: "Snooze until a time in the future" });
  const inbox = yield* Inbox;
  const item = yield* (yield* InboxRepository).snooze(itemId, request.until, inbox.channels, now);
  if (Option.isNone(item)) return yield* new InboxItemNotFound({ itemId });
  yield* inbox.publish([item.value]);
  yield* inbox.wake;
  return item.value;
});
