import { SubscribeRequest } from "@wiki-agents/contracts/events/subscribe/request";
import { SubscribeResponse } from "@wiki-agents/contracts/events/subscribe/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { subscribe } from "./use-case.js";

const Params = Schema.Struct({ connectionId: Schema.String });

export const subscribeEndpoint = Effect.gen(function* () {
  const { connectionId } = yield* HttpRouter.schemaPathParams(Params);
  const { subscriptionId, topic } = yield* HttpServerRequest.schemaBodyJson(SubscribeRequest);
  yield* subscribe(connectionId, subscriptionId, topic);
  return yield* HttpServerResponse.schemaJson(SubscribeResponse)({ subscriptionId });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ConnectionNotFound: () => Effect.succeed(notFound("Event stream not found")),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("subscribe to events")),
);
