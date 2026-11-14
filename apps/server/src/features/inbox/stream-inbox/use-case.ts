import type { InboxStreamMessage } from "@wiki-agents/contracts/inbox/event";
import { Effect, Stream } from "effect";
import { InboxBus } from "../inbox-bus.js";

/** The `inbox` topic: inbox items as they arrive or change; `ready` once subscribed. */
export const streamInbox = Effect.gen(function* () {
  const bus = yield* InboxBus;
  return Stream.unwrap(
    Effect.map(bus.subscribe, (subscription) =>
      Stream.concat(
        Stream.succeed<InboxStreamMessage>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.map((item): InboxStreamMessage => ({ type: "item.updated", item }))),
      ),
    ),
  );
});
