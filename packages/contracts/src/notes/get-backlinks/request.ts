import { Schema } from "effect";

/** GET /api/vaults/:vaultId/backlinks?path=<vault-relative path> */
export const GetBacklinksRequest = Schema.Struct({
  vaultId: Schema.String,
  path: Schema.String.check(Schema.isNonEmpty()),
});
export type GetBacklinksRequest = typeof GetBacklinksRequest.Type;
