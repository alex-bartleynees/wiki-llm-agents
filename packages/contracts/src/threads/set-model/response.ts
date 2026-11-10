import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

export const SetModelResponse = Schema.Struct({
  thread: ThreadSummary,
});
export type SetModelResponse = typeof SetModelResponse.Type;
