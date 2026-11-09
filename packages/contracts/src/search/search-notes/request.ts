import { Schema } from "effect";

/** Most results a search returns. */
export const SEARCH_LIMIT_MAX = 200;

/**
 * GET /api/vaults/:vaultId/search?q=<text>&tags=<a,b>&limit=<n>
 *
 * `q` is plain text: words match by prefix (as you type) and `"quoted phrases"`
 * exactly; nothing else is query syntax. `tags` is a comma-separated list (tags have
 * no commas); a note must have every tag, and `project` also matches `project/x`.
 * With tags and no text, every note with those tags is listed by title.
 */
export const SearchNotesRequest = Schema.Struct({
  vaultId: Schema.String,
  q: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.FiniteFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: SEARCH_LIMIT_MAX }))),
});
export type SearchNotesRequest = typeof SearchNotesRequest.Type;
