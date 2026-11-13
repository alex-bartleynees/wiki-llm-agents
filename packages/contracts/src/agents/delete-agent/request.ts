import { Schema } from "effect";

/**
 * DELETE /api/agents/:agentId?hash=…: moves `agents/<agentId>.md` to the config
 * directory's `.trash/`, only if it is still the version you saw (409 otherwise).
 * Threads using the agent keep their history and ask for another agent next turn.
 */
export const DeleteAgentRequest = Schema.Struct({
  agentId: Schema.String,
  /** SHA-256 of the file as last seen (`get-agent`). */
  hash: Schema.String,
});
export type DeleteAgentRequest = typeof DeleteAgentRequest.Type;
