import { ListModelsRequest } from "@wiki-agents/contracts/threads/list-models/request";
import { ListModelsResponse } from "@wiki-agents/contracts/threads/list-models/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { listModels } from "./use-case.js";

export const listModelsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(ListModelsRequest);
  return yield* HttpServerResponse.schemaJson(ListModelsResponse)(yield* listModels(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("list models")),
);
