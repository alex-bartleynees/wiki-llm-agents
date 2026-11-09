import { Schema } from "effect";

export const InterruptTurnResponse = Schema.Struct({
  turnId: Schema.String,
});
export type InterruptTurnResponse = typeof InterruptTurnResponse.Type;
