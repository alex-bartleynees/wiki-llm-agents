import { Schema } from "effect";

/** GET /api/vaults/:vaultId/note?path=<vault-relative path to a .md file> */
export const GetNoteRequest = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type GetNoteRequest = typeof GetNoteRequest.Type;
