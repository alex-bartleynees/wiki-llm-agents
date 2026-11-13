import { Schema } from "effect";
import { AgentInput } from "../model.js";

/**
 * PUT /api/agents/:agentId with this body: writes `agents/<agentId>.md` only if the
 * file is still the version the edit started from, else 409 and nothing is written.
 * Settings the app would refuse to load are refused with 422, one problem per line,
 * each starting with its field (`name: …`).
 */
export const SaveAgentRequest = Schema.Struct({
  agent: AgentInput,
  /** The `hash` the edit started from; null creates an agent that mustn't exist yet. */
  baseHash: Schema.NullOr(Schema.String),
});
export type SaveAgentRequest = typeof SaveAgentRequest.Type;
