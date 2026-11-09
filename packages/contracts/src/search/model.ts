import { Schema } from "effect";

/**
 * A piece of text from a note, marked when it matched the search. Snippets are sent
 * as parts rather than HTML, so the web app draws them as text and note content can
 * never become markup.
 */
export const SnippetPart = Schema.Struct({
  text: Schema.String,
  match: Schema.Boolean,
});
export type SnippetPart = typeof SnippetPart.Type;
