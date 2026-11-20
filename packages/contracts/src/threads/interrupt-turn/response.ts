import { Schema } from "effect";

export const InterruptTurnResponse = Schema.Struct({
  /** The turn that was stopped; null when no turn was running and only subagents were. */
  turnId: Schema.NullOr(Schema.String),
});
export type InterruptTurnResponse = typeof InterruptTurnResponse.Type;
