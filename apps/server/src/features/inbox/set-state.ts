import type { InboxItemState } from "@wiki-agents/contracts/inbox/model";
import { Effect, Option } from "effect";
import { WallClock } from "../../shared/wall-clock.js";
import { InboxItemNotFound } from "./errors.js";
import { Inbox } from "./inbox.js";
import { InboxRepository } from "./repository.js";

/** Dismisses an item or marks it done, and tells open browsers. */
export const setItemState = Effect.fnUntraced(function* (itemId: string, state: Exclude<InboxItemState, "open">) {
  const item = yield* (yield* InboxRepository).setState(itemId, state, yield* (yield* WallClock).now);
  if (Option.isNone(item)) return yield* new InboxItemNotFound({ itemId });
  yield* (yield* Inbox).publish([item.value]);
  return item.value;
});
