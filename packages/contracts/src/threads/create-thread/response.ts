import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

export const CreateThreadResponse = Schema.Struct({
  thread: ThreadSummary,
});
export type CreateThreadResponse = typeof CreateThreadResponse.Type;
