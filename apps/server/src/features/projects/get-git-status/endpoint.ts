import { GetGitStatusRequest } from "@wiki-agents/contracts/projects/get-git-status/request";
import { GetGitStatusResponse } from "@wiki-agents/contracts/projects/get-git-status/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { getGitStatus } from "./use-case.js";

export const getGitStatusEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetGitStatusRequest);
  return yield* HttpServerResponse.schemaJson(GetGitStatusResponse)(yield* getGitStatus(request.projectId));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("get project git status")),
);
