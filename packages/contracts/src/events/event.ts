import { Schema } from "effect";

/** Sent first: the id to subscribe with. A new connection (after a reconnect) gets a new id and no subscriptions. */
export const EventStreamConnected = Schema.Struct({
  type: Schema.Literal("connected"),
  connectionId: Schema.String,
});

/**
 * A message on one of the connection's subscriptions. `message` is that topic's own
 * message (`InboxStreamMessage`, `VaultEvent`...), which the subscriber decodes.
 */
export const EventStreamMessage = Schema.Struct({
  type: Schema.Literal("message"),
  subscriptionId: Schema.String,
  message: Schema.Unknown,
});

/** Events on GET /events, one JSON object per SSE `data:` line. */
export const EventStreamFrame = Schema.Union([EventStreamConnected, EventStreamMessage]);
export type EventStreamFrame = typeof EventStreamFrame.Type;
