import { Schema } from "effect";
import { FileKind } from "../../notes/model.js";

export const QuickSwitchResult = Schema.Struct({
  path: Schema.String,
  kind: FileKind,
  /** Note title (frontmatter `title` or the file name); the file name for other files. */
  title: Schema.String,
  /** Which text matched, and the indices (UTF-16) of the matched characters in it. */
  match: Schema.Struct({
    field: Schema.Literals(["title", "path"]),
    positions: Schema.Array(Schema.Number),
  }),
});
export type QuickSwitchResult = typeof QuickSwitchResult.Type;

/** Best matches first, at most 20. Empty for an empty query. */
export const QuickSwitchResponse = Schema.Struct({
  results: Schema.Array(QuickSwitchResult),
});
export type QuickSwitchResponse = typeof QuickSwitchResponse.Type;
