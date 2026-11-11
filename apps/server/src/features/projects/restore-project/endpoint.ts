import { RestoreProjectRequest } from "@wiki-agents/contracts/projects/restore-project/request";
import { RestoreProjectResponse } from "@wiki-agents/contracts/projects/restore-project/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { restoreProject } from "./use-case.js";

export const restoreProjectEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(RestoreProjectRequest);
  return yield* HttpServerResponse.schemaJson(RestoreProjectResponse)(yield* restoreProject(request.projectId));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("restore project")),
);
