import { AnswerRequestRequest } from "@wiki-agents/contracts/threads/answer-request/request";
import { AnswerRequestResponse } from "@wiki-agents/contracts/threads/answer-request/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

const Params = Schema.Struct({ threadId: Schema.String, requestId: Schema.String });

export const answerRequestEndpoint = Effect.gen(function* () {
  const { threadId, requestId } = yield* HttpRouter.schemaPathParams(Params);
  const { answer } = yield* HttpServerRequest.schemaBodyJson(AnswerRequestRequest);
  yield* (yield* ThreadActors).answerRequest(threadId, requestId, answer);
  return yield* HttpServerResponse.schemaJson(AnswerRequestResponse)({ requestId });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    RequestNotFound: () => Effect.succeed(notFound("Request not found")),
    RequestClosed: (error) => Effect.succeed(conflict(`Request already ${error.status}`)),
    WrongAnswerKind: () => Effect.succeed(conflict("This request takes a different kind of answer")),
  }),
  Effect.catch(internalError("answer request")),
);
