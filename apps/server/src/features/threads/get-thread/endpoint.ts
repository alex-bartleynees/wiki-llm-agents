import { GetThreadRequest } from "@wiki-agents/contracts/threads/get-thread/request";
import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getThread } from "./use-case.js";

export const getThreadEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetThreadRequest);
  return yield* HttpServerResponse.schemaJson(GetThreadResponse)(yield* getThread(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("get thread")),
);
