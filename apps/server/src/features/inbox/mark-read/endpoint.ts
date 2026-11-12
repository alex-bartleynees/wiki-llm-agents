import { MarkReadRequest } from "@wiki-agents/contracts/inbox/mark-read/request";
import { MarkReadResponse } from "@wiki-agents/contracts/inbox/mark-read/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { markRead } from "./use-case.js";

export const markReadEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(MarkReadRequest);
  const response: MarkReadResponse = { items: yield* markRead(request) };
  return yield* HttpServerResponse.schemaJson(MarkReadResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), HttpServerError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("mark inbox read")),
);
