import { CompactContextRequest } from "@wiki-agents/contracts/threads/compact-context/request";
import { CompactContextResponse } from "@wiki-agents/contracts/threads/compact-context/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

const Params = Schema.Struct({ threadId: Schema.String });

/** The thread's actor records the request and asks the provider, once per operation id. */
export const compactContextEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const { operationId } = yield* HttpServerRequest.schemaBodyJson(CompactContextRequest);
  const result = yield* (yield* ThreadActors).compact(threadId, operationId);
  return yield* HttpServerResponse.schemaJson(CompactContextResponse)(result, { status: 202 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    ThreadBusy: () => Effect.succeed(conflict("A turn is running or waiting for you")),
    CompactionUnavailable: (error) => Effect.succeed(conflict(error.reason)),
  }),
  Effect.catch(internalError("compact context")),
);
