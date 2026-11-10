import { Schema } from "effect";
import { ThreadSummary } from "../model.js";

export const SetAgentResponse = Schema.Struct({
  thread: ThreadSummary,
});
export type SetAgentResponse = typeof SetAgentResponse.Type;
