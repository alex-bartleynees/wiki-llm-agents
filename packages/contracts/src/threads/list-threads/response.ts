import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

/** The vault's threads, most recently updated first. */
export const ListThreadsResponse = Schema.Struct({
  threads: Schema.Array(ThreadSummary),
});
export type ListThreadsResponse = typeof ListThreadsResponse.Type;
