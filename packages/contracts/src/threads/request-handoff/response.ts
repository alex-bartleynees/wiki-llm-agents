import { Schema } from "effect";

/**
 * The handoff's turn; the agent's reply arrives on the thread's stream. `started` is
 * false when this operation id had already started it (a retry).
 */
export const RequestHandoffResponse = Schema.Struct({
  turnId: Schema.String,
  started: Schema.Boolean,
});
export type RequestHandoffResponse = typeof RequestHandoffResponse.Type;
