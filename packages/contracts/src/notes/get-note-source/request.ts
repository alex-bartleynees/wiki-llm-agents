import { Schema } from "effect";

/** GET /api/vaults/:vaultId/note/source?path=<vault-relative path to a .md file>: the markdown to edit. */
export const GetNoteSourceRequest = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type GetNoteSourceRequest = typeof GetNoteSourceRequest.Type;
