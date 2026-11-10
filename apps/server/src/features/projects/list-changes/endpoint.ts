import { ListChangesRequest } from "@wiki-agents/contracts/projects/list-changes/request";
import { ListChangesResponse } from "@wiki-agents/contracts/projects/list-changes/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { listChanges } from "./use-case.js";

export const listChangesEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(ListChangesRequest);
  const response = yield* listChanges(request.projectId);
  return yield* HttpServerResponse.schemaJson(ListChangesResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("list project changes")),
);
