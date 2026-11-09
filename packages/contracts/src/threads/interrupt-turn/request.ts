import { Schema } from "effect";

/** POST /api/threads/:threadId/interrupt, no body. Stops the running turn; 409 when none is running. */
export const InterruptTurnRequest = Schema.Struct({
  threadId: Schema.String,
});
export type InterruptTurnRequest = typeof InterruptTurnRequest.Type;
