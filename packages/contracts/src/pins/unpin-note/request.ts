import { Schema } from "effect";

/**
 * DELETE /api/vaults/:vaultId/pins?path=<vault-relative path>. Unpinning works for
 * files that are gone, and unpinning a file that isn't pinned changes nothing.
 */
export const UnpinNoteRequest = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type UnpinNoteRequest = typeof UnpinNoteRequest.Type;
