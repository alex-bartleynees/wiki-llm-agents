import { Schema } from "effect";

/** GET /api/providers/:providerInstanceId/models: the models a provider offers, without a thread (for the agent editor). */
export const ListProviderModelsRequest = Schema.Struct({
  providerInstanceId: Schema.String,
});
export type ListProviderModelsRequest = typeof ListProviderModelsRequest.Type;
