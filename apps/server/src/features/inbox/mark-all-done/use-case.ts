import type { MarkAllDoneRequest } from "@wiki-agents/contracts/inbox/mark-all-done/request";
import { Effect } from "effect";
import { WallClock } from "../../../shared/wall-clock.js";
import { Inbox } from "../inbox.js";
import { InboxRepository } from "../repository.js";

/** Publishes only the rows changed by the committed transaction. */
export const markAllDone = Effect.fnUntraced(function* (request: MarkAllDoneRequest) {
  const repository = yield* InboxRepository;
  const inbox = yield* Inbox;
  const at = yield* (yield* WallClock).now;
  return yield* repository.markAllDone(request.targets, at).pipe(
    Effect.tap((items) => inbox.publish(items)),
    Effect.uninterruptible,
  );
});
