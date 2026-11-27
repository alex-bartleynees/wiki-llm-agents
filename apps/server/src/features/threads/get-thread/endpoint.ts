import { GetThreadRequest } from "@wiki-agents/contracts/threads/get-thread/request";
import { GetThreadResponse } from "@wiki-agents/contracts/threads/get-thread/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { matchesIfNoneMatch } from "../../../shared/etag.js";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getThreadSummary, getThreadWithSummary, threadEtag } from "./use-case.js";

export const getThreadEndpoint = Effect.gen(function* () {
  const httpRequest = yield* HttpServerRequest.HttpServerRequest;
  const request = yield* HttpRouter.schemaPathParams(GetThreadRequest);
  const thread = yield* getThreadSummary(request);
  const summaryEtag = threadEtag(thread);
  if (matchesIfNoneMatch(httpRequest.headers["if-none-match"], summaryEtag)) {
    return HttpServerResponse.empty({ status: 304, headers: { etag: summaryEtag, "cache-control": "no-cache" } });
  }
  const body = yield* getThreadWithSummary(thread);
  const response = yield* HttpServerResponse.schemaJson(GetThreadResponse)(body);
  return HttpServerResponse.setHeaders(response, { etag: threadEtag(body.thread), "cache-control": "no-cache" });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("get thread")),
);
