import { Schema } from "effect";

/** POST /api/threads/:threadId/reopen, no body. Moves a done thread back to the open ones; an open thread is left as it is. */
export const ReopenThreadRequest = Schema.Struct({
  threadId: Schema.String,
});
export type ReopenThreadRequest = typeof ReopenThreadRequest.Type;
