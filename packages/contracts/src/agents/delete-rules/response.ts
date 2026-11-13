import { Schema } from "effect";

export const DeleteRulesResponse = Schema.Struct({
  trashPath: Schema.String,
});
export type DeleteRulesResponse = typeof DeleteRulesResponse.Type;
