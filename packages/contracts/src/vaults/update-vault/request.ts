import { Schema } from "effect";

/** PATCH /api/vaults/:vaultId (body): a vault's settings. */
export const UpdateVaultRequest = Schema.Struct({
  /** A folder in the vault (vault-relative) whose notes are templates; null or "" turns templates off. */
  templateFolder: Schema.NullOr(Schema.String),
});
export type UpdateVaultRequest = typeof UpdateVaultRequest.Type;
