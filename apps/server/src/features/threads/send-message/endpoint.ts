import { SendMessageRequest } from "@wiki-agents/contracts/threads/send-message/request";
import { SendMessageResponse } from "@wiki-agents/contracts/threads/send-message/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

const Params = Schema.Struct({ threadId: Schema.String });

/** The thread's actor records the message and starts the turn, one at a time. */
export const sendMessageEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Params);
  const { text } = yield* HttpServerRequest.schemaBodyJson(SendMessageRequest);
  const turnId = yield* (yield* ThreadActors).sendMessage(threadId, text);
  return yield* HttpServerResponse.schemaJson(SendMessageResponse)({ turnId }, { status: 202 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    ThreadBusy: () => Effect.succeed(conflict("A turn is already running")),
  }),
  Effect.catch(internalError("send message")),
);
