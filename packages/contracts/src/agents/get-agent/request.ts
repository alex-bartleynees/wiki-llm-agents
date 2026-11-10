import { Schema } from "effect";

/** GET /api/agents/:agentId */
export const GetAgentRequest = Schema.Struct({
  agentId: Schema.String,
});
export type GetAgentRequest = typeof GetAgentRequest.Type;
