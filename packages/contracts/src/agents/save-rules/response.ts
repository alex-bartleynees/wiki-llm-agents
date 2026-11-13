import { Schema } from "effect";

export const SaveRulesResponse = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  /** SHA-256 (hex) of what is now on disk: the next save's `baseHash`. */
  hash: Schema.String,
});
export type SaveRulesResponse = typeof SaveRulesResponse.Type;
