import { Schema } from "effect";
import { Vault } from "../model.js";

export const ListVaultsResponse = Schema.Struct({
  vaults: Schema.Array(Vault),
});
export type ListVaultsResponse = typeof ListVaultsResponse.Type;
