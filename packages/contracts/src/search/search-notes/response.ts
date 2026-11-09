import { Schema } from "effect";
import { SnippetPart } from "../model.js";

export const SearchResult = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
  /** A short passage of the body around the best match, with the matched words marked. */
  snippet: Schema.Array(SnippetPart),
});
export type SearchResult = typeof SearchResult.Type;

/** Best matches first. `truncated` when there were more than the limit. */
export const SearchNotesResponse = Schema.Struct({
  results: Schema.Array(SearchResult),
  truncated: Schema.Boolean,
});
export type SearchNotesResponse = typeof SearchNotesResponse.Type;
