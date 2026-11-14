import { Schema } from "effect";

/**
 * GET /events takes no input: a server-sent event stream of `EventStreamFrame`s, one
 * per browser tab. It starts with `connected`; subscribe to topics with
 * POST /api/events/:connectionId/subscriptions. One stream carries every topic, so a
 * tab holds one of the browser's six HTTP/1.1 connections per host, not one per topic.
 */
export const OpenEventStreamRequest = Schema.Struct({});
export type OpenEventStreamRequest = typeof OpenEventStreamRequest.Type;
