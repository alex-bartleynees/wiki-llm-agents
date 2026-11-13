import { Schema } from "effect";

/** GET /api/active-threads takes no input: threads working, waiting for you, or stopped, in every vault. */
export const ListActiveThreadsRequest = Schema.Struct({});
export type ListActiveThreadsRequest = typeof ListActiveThreadsRequest.Type;
