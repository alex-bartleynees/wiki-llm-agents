import { Schema } from "effect";

/**
 * POST /api/threads/:threadId/interrupt, no body. Stops everything: the running turn
 * and every subagent at work; 409 when neither is.
 */
export const InterruptTurnRequest = Schema.Struct({
  threadId: Schema.String,
});
export type InterruptTurnRequest = typeof InterruptTurnRequest.Type;
