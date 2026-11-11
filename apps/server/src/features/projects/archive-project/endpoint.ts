import { ArchiveProjectRequest } from "@wiki-agents/contracts/projects/archive-project/request";
import { ArchiveProjectResponse } from "@wiki-agents/contracts/projects/archive-project/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { archiveProject } from "./use-case.js";

export const archiveProjectEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(ArchiveProjectRequest);
  return yield* HttpServerResponse.schemaJson(ArchiveProjectResponse)(yield* archiveProject(request.projectId));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("archive project")),
);
