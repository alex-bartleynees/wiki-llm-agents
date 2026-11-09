import { Schema } from "effect";

/** GET /api/vaults/:vaultId/tree */
export const GetTreeRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type GetTreeRequest = typeof GetTreeRequest.Type;
