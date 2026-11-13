import { Schema } from "effect";
import { ProviderModel } from "../model.js";

export const ListProviderModelsResponse = Schema.Struct({
  /** Empty when the provider offers no choice of models. */
  models: Schema.Array(ProviderModel),
  /** The model it uses when none is set; null when unknown. */
  defaultModel: Schema.NullOr(Schema.String),
});
export type ListProviderModelsResponse = typeof ListProviderModelsResponse.Type;
