import { Schema } from "effect";
import { AgentSummary } from "../model.js";

/** The agent as it is now on disk. */
export const SaveAgentResponse = Schema.Struct({
  agent: AgentSummary,
  instructions: Schema.String,
  /** SHA-256 (hex) of what is now on disk: the next save's `baseHash`. */
  hash: Schema.String,
});
export type SaveAgentResponse = typeof SaveAgentResponse.Type;
