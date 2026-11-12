import { InboxStreamMessage } from "@wiki-agents/contracts/inbox/event";
import { Effect, Schema, Stream } from "effect";
import { sseFrame } from "../../../shared/sse.js";
import { InboxBus } from "../inbox-bus.js";

const encode = Schema.encodeSync(Schema.fromJsonString(InboxStreamMessage));

/** Inbox items as they arrive or change, as SSE frames; `ready` once subscribed. */
export const streamInbox = Effect.gen(function* () {
  const bus = yield* InboxBus;
  return Stream.unwrap(
    Effect.map(bus.subscribe, (subscription) =>
      Stream.concat(
        Stream.succeed<InboxStreamMessage>({ type: "ready" }),
        Stream.fromSubscription(subscription).pipe(Stream.map((item): InboxStreamMessage => ({ type: "item.updated", item }))),
      ),
    ),
  ).pipe(Stream.map((message) => sseFrame(encode(message))));
});
