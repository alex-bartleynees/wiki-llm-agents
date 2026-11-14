import { UnsubscribeRequest } from "@wiki-agents/contracts/events/unsubscribe/request";
import { UnsubscribeResponse } from "@wiki-agents/contracts/events/unsubscribe/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { EventConnections } from "../connections.js";

export const unsubscribeEndpoint = Effect.gen(function* () {
  const { connectionId, subscriptionId } = yield* HttpRouter.schemaPathParams(UnsubscribeRequest);
  yield* (yield* EventConnections).unsubscribe(connectionId, subscriptionId);
  return yield* HttpServerResponse.schemaJson(UnsubscribeResponse)({ subscriptionId });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ConnectionNotFound: () => Effect.succeed(notFound("Event stream not found")),
  }),
  Effect.catch(internalError("unsubscribe from events")),
);
