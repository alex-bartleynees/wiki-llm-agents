import { Schema } from "effect";

/**
 * POST /api/threads/:threadId/done, no body. The thread moves to the thread list's
 * Done group; sending it a message reopens it. Refused (409) while a turn runs or
 * waits for an answer. Marking a done thread done keeps its first `doneAt`.
 */
export const MarkDoneRequest = Schema.Struct({
  threadId: Schema.String,
});
export type MarkDoneRequest = typeof MarkDoneRequest.Type;
