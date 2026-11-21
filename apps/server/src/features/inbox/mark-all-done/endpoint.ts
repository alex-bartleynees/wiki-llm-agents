import { MarkAllDoneRequest } from "@wiki-agents/contracts/inbox/mark-all-done/request";
import { MarkAllDoneResponse } from "@wiki-agents/contracts/inbox/mark-all-done/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { markAllDone } from "./use-case.js";

export const markAllDoneEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(MarkAllDoneRequest);
  const response: MarkAllDoneResponse = { items: yield* markAllDone(request) };
  return yield* HttpServerResponse.schemaJson(MarkAllDoneResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()), HttpServerError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("mark all inbox items done")),
);
