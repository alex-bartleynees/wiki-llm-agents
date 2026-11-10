import { Schema } from "effect";
import { AgentSummary } from "../model.js";

export const GetAgentResponse = Schema.Struct({
  agent: AgentSummary,
  /** The file's body: what the agent is told, as markdown. */
  instructions: Schema.String,
});
export type GetAgentResponse = typeof GetAgentResponse.Type;
