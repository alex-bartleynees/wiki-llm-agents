import { homedir } from "node:os";
import { ListProviderModelsRequest } from "@wiki-agents/contracts/providers/list-provider-models/request";
import { ListProviderModelsResponse } from "@wiki-agents/contracts/providers/list-provider-models/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { ProviderRegistry } from "../registry.js";

/**
 * The provider's models outside any thread, for choosing an agent's model. Listed in
 * the home folder, so project-specific provider config doesn't apply.
 */
export const listProviderModelsEndpoint = Effect.gen(function* () {
  const { providerInstanceId } = yield* HttpRouter.schemaPathParams(ListProviderModelsRequest);
  const { adapter } = yield* (yield* ProviderRegistry).get(providerInstanceId);
  const response: ListProviderModelsResponse = adapter.capabilities.models ? yield* adapter.listModels(homedir()) : { models: [], defaultModel: null };
  return yield* HttpServerResponse.schemaJson(ListProviderModelsResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProviderInstanceNotFound: () => Effect.succeed(notFound("Provider not found")),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("list provider models")),
);
