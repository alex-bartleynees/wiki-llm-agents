import { Schema } from "effect";

/**
 * PUT /api/vaults/:vaultId/note/source with this body. Writes the note only if the
 * file is still the version the editor started from, else 409 and nothing is
 * written (fetch the source again to see what changed).
 */
export const SaveNoteRequest = Schema.Struct({
  /** Vault-relative path of a `.md` file. */
  path: Schema.String.check(Schema.isNonEmpty()),
  content: Schema.String,
  /** The `hash` the edit started from; null creates a note that mustn't exist yet. */
  baseHash: Schema.NullOr(Schema.String),
});
export type SaveNoteRequest = typeof SaveNoteRequest.Type;
