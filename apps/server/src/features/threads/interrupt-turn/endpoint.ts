import { InterruptTurnRequest } from "@wiki-agents/contracts/threads/interrupt-turn/request";
import { InterruptTurnResponse } from "@wiki-agents/contracts/threads/interrupt-turn/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { ThreadActors } from "../thread-actors.js";

export const interruptTurnEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(InterruptTurnRequest);
  const turnId = yield* (yield* ThreadActors).interrupt(threadId);
  return yield* HttpServerResponse.schemaJson(InterruptTurnResponse)({ turnId });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
    NoTurnRunning: () => Effect.succeed(conflict("No turn is running")),
  }),
  Effect.catch(internalError("interrupt turn")),
);
