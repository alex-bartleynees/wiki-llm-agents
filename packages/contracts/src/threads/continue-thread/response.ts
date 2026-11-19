import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

/** The new thread; its draft holds the handoff. */
export const ContinueThreadResponse = Schema.Struct({
  thread: ThreadSummary,
});
export type ContinueThreadResponse = typeof ContinueThreadResponse.Type;
