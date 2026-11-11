import { ReopenThreadRequest } from "@wiki-agents/contracts/threads/reopen-thread/request";
import { ReopenThreadResponse } from "@wiki-agents/contracts/threads/reopen-thread/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

export const reopenThreadEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(ReopenThreadRequest);
  const thread = yield* (yield* ThreadActors).setDone(threadId, false);
  return yield* HttpServerResponse.schemaJson(ReopenThreadResponse)({ thread });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("reopen thread")),
);
