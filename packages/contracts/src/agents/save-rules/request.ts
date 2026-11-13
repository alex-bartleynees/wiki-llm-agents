import { Schema } from "effect";

/**
 * PUT /api/rules/:rulesId with this body: writes `rules/<rulesId>.md` only if the
 * file is still the version the edit started from (409 otherwise). A file the app
 * wouldn't load (an empty one) is refused with 422.
 */
export const SaveRulesRequest = Schema.Struct({
  content: Schema.String,
  /** The `hash` the edit started from; null creates a rules file that mustn't exist yet. */
  baseHash: Schema.NullOr(Schema.String),
});
export type SaveRulesRequest = typeof SaveRulesRequest.Type;
