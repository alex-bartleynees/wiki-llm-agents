import { Schema } from "effect";
import { Vault } from "../model.js";

export const RegisterVaultResponse = Schema.Struct({
  vault: Vault,
});
export type RegisterVaultResponse = typeof RegisterVaultResponse.Type;
