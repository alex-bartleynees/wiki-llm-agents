import { Schema } from "effect";
import { ProviderInstance } from "../model.js";

export const ListProvidersResponse = Schema.Struct({
  providers: Schema.Array(ProviderInstance),
});
export type ListProvidersResponse = typeof ListProvidersResponse.Type;
