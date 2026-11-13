import { Schema } from "effect";
import { AgentSummary } from "../model.js";

export const GetAgentResponse = Schema.Struct({
  agent: AgentSummary,
  /** The file's body: what the agent is told, as markdown. */
  instructions: Schema.String,
  /** SHA-256 (hex) of the file's bytes: the `baseHash` for saving or deleting it. */
  hash: Schema.String,
});
export type GetAgentResponse = typeof GetAgentResponse.Type;
