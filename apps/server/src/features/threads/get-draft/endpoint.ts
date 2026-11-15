import { GetDraftRequest } from "@wiki-agents/contracts/threads/get-draft/request";
import { GetDraftResponse } from "@wiki-agents/contracts/threads/get-draft/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { getDraft } from "./use-case.js";

export const getDraftEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetDraftRequest);
  return yield* HttpServerResponse.schemaJson(GetDraftResponse)(yield* getDraft(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("get-draft")),
);
