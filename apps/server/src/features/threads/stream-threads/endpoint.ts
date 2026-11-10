import { StreamThreadsRequest } from "@wiki-agents/contracts/threads/stream-threads/request";
import { Effect } from "effect";
import { HttpRouter } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { sseResponse } from "../../../shared/sse.js";
import { streamThreads } from "./use-case.js";

export const streamThreadsEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(StreamThreadsRequest);
  return yield* sseResponse(yield* streamThreads(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    VaultNotFound: () => Effect.succeed(notFound("Vault not found")),
  }),
  Effect.catch(internalError("stream threads")),
);
