import { Schema } from "effect";
import { ProviderModel } from "../../providers/model.js";

/** The models the thread's provider offers in its working directory. */
export const ListModelsResponse = Schema.Struct({
  models: Schema.Array(ProviderModel),
  /** The model the thread uses: its own choice, else the provider's default; null when unknown. */
  current: Schema.NullOr(Schema.String),
});
export type ListModelsResponse = typeof ListModelsResponse.Type;
