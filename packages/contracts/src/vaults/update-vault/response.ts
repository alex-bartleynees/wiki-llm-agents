import { Schema } from "effect";
import { Vault } from "../model.js";

export const UpdateVaultResponse = Schema.Struct({
  vault: Vault,
});
export type UpdateVaultResponse = typeof UpdateVaultResponse.Type;
