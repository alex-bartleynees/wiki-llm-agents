import { Schema } from "effect";

/**
 * GET /events/threads/:threadId?after=<seq>: a server-sent event stream of
 * `ThreadStreamMessage`s. Every stored event with a greater seq is sent first, then
 * live events. On reconnect the browser's `Last-Event-ID` header takes the place of
 * `after`, so nothing is missed or sent twice.
 */
export const StreamThreadEventsRequest = Schema.Struct({
  threadId: Schema.String,
  after: Schema.optionalKey(Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
});
export type StreamThreadEventsRequest = typeof StreamThreadEventsRequest.Type;
