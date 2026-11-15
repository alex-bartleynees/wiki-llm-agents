import { SaveDraftRequest } from "@wiki-agents/contracts/threads/save-draft/request";
import { SaveDraftResponse } from "@wiki-agents/contracts/threads/save-draft/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { saveDraft } from "./use-case.js";

export const saveDraftEndpoint = Effect.gen(function* () {
  const { threadId } = yield* HttpRouter.schemaPathParams(Schema.Struct({ threadId: Schema.String }));
  const body = yield* HttpServerRequest.schemaBodyJson(SaveDraftRequest);
  const request = { ...body, threadId };
  return yield* HttpServerResponse.schemaJson(SaveDraftResponse)(yield* saveDraft(request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    DraftConflict: () => Effect.succeed(conflict("This draft changed in another tab or device. Copy your text before reloading.")),
    ThreadNotFound: () => Effect.succeed(notFound("Thread not found")),
  }),
  Effect.catch(internalError("save-draft")),
);
