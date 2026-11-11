import { MarkDoneRequest } from "@wiki-agents/contracts/threads/mark-done/request";
import { MarkDoneResponse } from "@wiki-agents/contracts/threads/mark-done/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

export const markDoneEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(MarkDoneRequest);
  const thread = yield* (yield* ThreadActors).setDone(threadId, true);
  return yield* HttpServerResponse.schemaJson(MarkDoneResponse)({ thread });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    ThreadBusy: () => Effect.succeed(conflict("Stop the turn or answer it before marking the thread done")),
  }),
  Effect.catch(internalError("mark thread done")),
);
