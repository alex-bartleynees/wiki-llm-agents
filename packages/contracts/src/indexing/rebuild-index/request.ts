import { Schema } from "effect";

/** POST /api/vaults/:vaultId/rebuild-index: drop the vault's index and rebuild it from disk. */
export const RebuildIndexRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type RebuildIndexRequest = typeof RebuildIndexRequest.Type;
