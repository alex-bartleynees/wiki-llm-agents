import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

export const MarkDoneResponse = Schema.Struct({
  thread: ThreadSummary,
});
export type MarkDoneResponse = typeof MarkDoneResponse.Type;
