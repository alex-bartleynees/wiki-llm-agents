import { Schema } from "effect";

/** GET /api/vaults/:vaultId/pins */
export const ListPinsRequest = Schema.Struct({
  vaultId: Schema.String,
});
export type ListPinsRequest = typeof ListPinsRequest.Type;
