import { Schema } from "effect";
import { FileKind } from "../notes/model.js";

/** A file pinned in a vault, shown above the tree on every device. */
export const Pin = Schema.Struct({
  path: Schema.String,
  kind: FileKind,
  /** The note's title or file name; null when the file is no longer in the vault (moved or deleted). */
  title: Schema.NullOr(Schema.String),
});
export type Pin = typeof Pin.Type;
