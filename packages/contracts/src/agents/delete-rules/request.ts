import { Schema } from "effect";

/** DELETE /api/rules/:rulesId?hash=…: moves the rules file to `.trash/`, as deleting an agent does. */
export const DeleteRulesRequest = Schema.Struct({
  rulesId: Schema.String,
  hash: Schema.String,
});
export type DeleteRulesRequest = typeof DeleteRulesRequest.Type;
