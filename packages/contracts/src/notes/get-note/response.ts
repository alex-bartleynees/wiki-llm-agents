import { Schema } from "effect";
import { Heading, NoteLink } from "../model.js";

export const GetNoteResponse = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String,
  /** Frontmatter `title`, else the file name without `.md`. */
  title: Schema.String,
  /** Rendered, sanitised HTML of the body (frontmatter excluded). */
  html: Schema.String,
  frontmatter: Schema.Record(Schema.String, Schema.Json),
  tags: Schema.Array(Schema.String),
  /** Last modified on disk, in milliseconds since the epoch. */
  modifiedAt: Schema.Number,
  links: Schema.Array(NoteLink),
  /** Headings in document order, for the outline. */
  headings: Schema.Array(Heading),
});
export type GetNoteResponse = typeof GetNoteResponse.Type;
