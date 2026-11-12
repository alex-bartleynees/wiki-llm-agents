import { Schema } from "effect";

export const SaveNoteResponse = Schema.Struct({
  path: Schema.String,
  /** SHA-256 (hex) of what is now on disk: the next save's `baseHash`. */
  hash: Schema.String,
  /** Last modified on disk, in milliseconds since the epoch. */
  modifiedAt: Schema.Number,
});
export type SaveNoteResponse = typeof SaveNoteResponse.Type;
