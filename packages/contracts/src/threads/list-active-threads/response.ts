import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

/** Threads whose `threadActivity` isn't null, most recently updated first. */
export const ListActiveThreadsResponse = Schema.Struct({
  threads: Schema.Array(ThreadSummary),
});
export type ListActiveThreadsResponse = typeof ListActiveThreadsResponse.Type;
