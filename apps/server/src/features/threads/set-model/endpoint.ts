import { SetModelRequest } from "@wiki-agents/contracts/threads/set-model/request";
import { SetModelResponse } from "@wiki-agents/contracts/threads/set-model/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badGateway, badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { setModel } from "./use-case.js";

const Params = Schema.Struct({ threadId: Schema.String });

export const setModelEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(SetModelRequest);
  return yield* HttpServerResponse.schemaJson(SetModelResponse)(yield* setModel({ ...body, threadId }));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    UnknownModel: (error) => Effect.succeed(badRequest(`This provider doesn't offer ${error.model}`)),
    ProviderError: (error) => Effect.succeed(badGateway(error.message)),
  }),
  Effect.catch(internalError("set model")),
);
