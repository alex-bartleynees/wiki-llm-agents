import { CommitChangesRequest } from "@wiki-agents/contracts/projects/commit-changes/request";
import { CommitChangesResponse } from "@wiki-agents/contracts/projects/commit-changes/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { commitChanges } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const commitChangesEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(CommitChangesRequest);
  return yield* HttpServerResponse.schemaJson(CommitChangesResponse)(yield* commitChanges(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    StaleReview: (error) => Effect.succeed(conflict(error.message)),
    GitRefused: (error) => Effect.succeed(conflict(error.message)),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("commit project changes")),
);
