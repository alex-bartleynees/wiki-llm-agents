import { RequestHandoffRequest } from "@wiki-agents/contracts/threads/request-handoff/request";
import { RequestHandoffResponse } from "@wiki-agents/contracts/threads/request-handoff/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

const Params = Schema.Struct({ threadId: Schema.String });

/** The thread's actor records the request and asks the agent, once per operation id. */
export const requestHandoffEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const { operationId } = yield* HttpServerRequest.schemaBodyJson(RequestHandoffRequest);
  const result = yield* (yield* ThreadActors).handoff(threadId, operationId);
  return yield* HttpServerResponse.schemaJson(RequestHandoffResponse)(result, { status: 202 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    ThreadBusy: () => Effect.succeed(conflict("A turn is running or waiting for you")),
    HandoffUnavailable: (error) => Effect.succeed(conflict(error.reason)),
  }),
  Effect.catch(internalError("request handoff")),
);
