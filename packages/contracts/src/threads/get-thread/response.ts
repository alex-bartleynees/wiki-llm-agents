import { Schema } from "effect";
import { StoredThreadEvent, ThreadSummary } from "../model.js";

/** The thread and all its events so far; follow with the event stream from `thread.lastSeq`. */
export const GetThreadResponse = Schema.Struct({
  thread: ThreadSummary,
  events: Schema.Array(StoredThreadEvent),
});
export type GetThreadResponse = typeof GetThreadResponse.Type;
