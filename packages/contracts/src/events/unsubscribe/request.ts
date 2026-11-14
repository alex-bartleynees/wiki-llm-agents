import { Schema } from "effect";

/**
 * DELETE /api/events/:connectionId/subscriptions/:subscriptionId: no more messages
 * for it. An unknown subscription is fine (it may have ended); 404 for an unknown connection.
 */
export const UnsubscribeRequest = Schema.Struct({ connectionId: Schema.String, subscriptionId: Schema.String });
export type UnsubscribeRequest = typeof UnsubscribeRequest.Type;
