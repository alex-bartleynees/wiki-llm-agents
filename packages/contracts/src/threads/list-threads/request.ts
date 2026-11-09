import { Schema } from "effect";

/** GET /api/vaults/:vaultId/threads */
export const ListThreadsRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type ListThreadsRequest = typeof ListThreadsRequest.Type;
