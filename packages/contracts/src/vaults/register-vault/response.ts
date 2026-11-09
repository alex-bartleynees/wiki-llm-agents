import { Schema } from "effect";
import { Vault } from "../model.js";

/**
 * 201 when the vault was added, 200 when the folder was already registered
 * (registering is idempotent, so the `--vault` start flag can repeat it).
 */
export const RegisterVaultResponse = Schema.Struct({
  vault: Vault,
});
export type RegisterVaultResponse = typeof RegisterVaultResponse.Type;
