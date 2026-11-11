import { GetDiffRequest } from "@wiki-agents/contracts/projects/get-diff/request";
import { GetDiffResponse } from "@wiki-agents/contracts/projects/get-diff/response";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { getDiff } from "./use-case.js";

export const getDiffEndpoint = Effect.gen(function* () {
  const request = yield* HttpRouter.schemaPathParams(GetDiffRequest);
  const response = yield* getDiff(request.projectId);
  return yield* HttpServerResponse.schemaJson(GetDiffResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("get project diff")),
);
