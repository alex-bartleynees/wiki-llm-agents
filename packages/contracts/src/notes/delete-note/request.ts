import { Schema } from "effect";

/**
 * DELETE /api/vaults/:vaultId/note?path=…&hash=…: moves a note to the vault's
 * `.trash/` folder (as Obsidian's "Move to Obsidian trash" does), only if it is still
 * the version you saw.
 */
export const DeleteNoteRequest = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String,
  /** SHA-256 of the note's bytes as last seen (`get-note-source`); 409 when it has changed. */
  hash: Schema.String,
});
export type DeleteNoteRequest = typeof DeleteNoteRequest.Type;
