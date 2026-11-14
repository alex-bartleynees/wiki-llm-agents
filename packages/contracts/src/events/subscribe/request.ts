import { Schema } from "effect";
import { EventTopic } from "../model.js";

/**
 * POST /api/events/:connectionId/subscriptions with this body. The client picks
 * `subscriptionId` (unique on its connection; reusing one replaces that subscription).
 * Answers once the server is subscribed, after the topic's `ready` message is queued.
 * 404 for an unknown connection, vault or thread.
 */
export const SubscribeRequest = Schema.Struct({
  subscriptionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  topic: EventTopic,
});
export type SubscribeRequest = typeof SubscribeRequest.Type;
