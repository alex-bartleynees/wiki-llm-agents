import { Schema } from "effect";

export const GetNoteSourceResponse = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String,
  /** The file as it is on disk, decoded as UTF-8. */
  content: Schema.String,
  /** SHA-256 (hex) of the file's bytes: send it back as `baseHash` when saving. */
  hash: Schema.String,
  /** Last modified on disk, in milliseconds since the epoch. */
  modifiedAt: Schema.Number,
});
export type GetNoteSourceResponse = typeof GetNoteSourceResponse.Type;
