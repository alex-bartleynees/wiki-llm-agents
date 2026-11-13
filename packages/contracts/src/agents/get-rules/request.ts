import { Schema } from "effect";

/** GET /api/rules/:rulesId */
export const GetRulesRequest = Schema.Struct({
  rulesId: Schema.String,
});
export type GetRulesRequest = typeof GetRulesRequest.Type;
