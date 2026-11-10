import { ReviewChangesRequest } from "@wiki-agents/contracts/projects/review-changes/request";
import { ReviewChangesResponse } from "@wiki-agents/contracts/projects/review-changes/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { reviewChanges } from "./use-case.js";

export const reviewChangesEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(ReviewChangesRequest);
  const response = yield* reviewChanges(request.projectId);
  return yield* HttpServerResponse.schemaJson(ReviewChangesResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("review project changes")),
);
