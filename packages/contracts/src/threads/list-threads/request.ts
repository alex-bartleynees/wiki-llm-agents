import { Schema } from "effect";

/** GET /api/vaults/:vaultId/threads */
export const ListThreadsRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type ListThreadsRequest = typeof ListThreadsRequest.Type;

/** Lists the vault's own threads (those without a project) with `?projectId=none`. */
export const VAULT_THREADS = "none";

/**
 * `?projectId=<id>` lists that project's threads, `?projectId=none` the vault's own
 * threads; without it, every thread in the vault.
 */
export const ListThreadsQuery = Schema.Struct({ projectId: Schema.optionalKey(Schema.String) });
export type ListThreadsQuery = typeof ListThreadsQuery.Type;
