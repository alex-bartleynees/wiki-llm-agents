import { Schema } from "effect";

/**
 * POST /api/threads/:threadId/handoff with this body: asks the thread's agent, in its
 * own session, to write a handoff for continuing in a new thread. It runs as a turn
 * (it uses some of your usage); the agent's reply is the handoff. 409 while a turn
 * runs or waits for you, or when there is no conversation yet.
 */
export const RequestHandoffRequest = Schema.Struct({
  /**
   * Chosen by the client for this click; it becomes the turn's id. Sending the same
   * id again (a retry after a timeout) returns that turn and never asks twice.
   */
  operationId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9-]{8,64}$/)),
});
export type RequestHandoffRequest = typeof RequestHandoffRequest.Type;
