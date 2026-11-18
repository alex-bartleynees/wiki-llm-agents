import { Schema } from "effect";

/**
 * POST /api/threads/:threadId/compact with this body: asks the thread's provider to
 * compact the conversation in its own session. 409 while a turn runs or waits for
 * you, or when the provider can't compact or there is no conversation yet.
 */
export const CompactContextRequest = Schema.Struct({
  /**
   * Chosen by the client for this click; it becomes the compaction's turn id. Sending
   * the same id again (a retry after a timeout) returns that turn and never compacts twice.
   */
  operationId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{8,64}$/)),
});
export type CompactContextRequest = typeof CompactContextRequest.Type;
