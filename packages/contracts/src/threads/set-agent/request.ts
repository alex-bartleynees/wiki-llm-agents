import { Schema } from "effect";

/** PUT /api/threads/:threadId/agent with this body. Applies from the next turn; null for no agent. */
export const SetAgentRequest = Schema.Struct({
  agentId: Schema.NullOr(Schema.String.check(Schema.isNonEmpty())),
});
export type SetAgentRequest = typeof SetAgentRequest.Type;
