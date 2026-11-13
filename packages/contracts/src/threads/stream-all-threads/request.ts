import { Schema } from "effect";

/**
 * GET /events/threads takes no input: `ThreadsStreamMessage`s for every thread in
 * every vault, for the running view. No replay: reload the list after a reconnect.
 */
export const StreamAllThreadsRequest = Schema.Struct({});
export type StreamAllThreadsRequest = typeof StreamAllThreadsRequest.Type;
