import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

export const ReopenThreadResponse = Schema.Struct({
  thread: ThreadSummary,
});
export type ReopenThreadResponse = typeof ReopenThreadResponse.Type;
