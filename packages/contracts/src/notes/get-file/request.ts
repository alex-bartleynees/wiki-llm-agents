import { Schema } from "effect";

/**
 * GET /api/vaults/:vaultId/files?path=<vault-relative path>
 * Returns the file's bytes (images embedded in notes), so there is no response schema.
 */
export const GetFileRequest = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type GetFileRequest = typeof GetFileRequest.Type;
