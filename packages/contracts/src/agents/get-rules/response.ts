import { Schema } from "effect";

/** A rules file as it is on disk, frontmatter and all. */
export const GetRulesResponse = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  content: Schema.String,
  /** SHA-256 (hex) of the file's bytes: the `baseHash` for saving or deleting it. */
  hash: Schema.String,
});
export type GetRulesResponse = typeof GetRulesResponse.Type;
