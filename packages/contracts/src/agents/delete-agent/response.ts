import { Schema } from "effect";

export const DeleteAgentResponse = Schema.Struct({
  /** Where the file went: `<config dir>/.trash/agents/<id>.md`, or `<id> 1.md` when that was taken. */
  trashPath: Schema.String,
});
export type DeleteAgentResponse = typeof DeleteAgentResponse.Type;
