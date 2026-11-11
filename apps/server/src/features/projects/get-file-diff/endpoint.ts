import { GetFileDiffRequest } from "@wiki-agents/contracts/projects/get-file-diff/request";
import { GetFileDiffResponse } from "@wiki-agents/contracts/projects/get-file-diff/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, conflict, internalError, notFound } from "../../../shared/http-errors.js";
import { getFileDiff } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const getFileDiffEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const request = yield* HttpServerRequest.schemaSearchParams(GetFileDiffRequest);
  const response = yield* getFileDiff(projectId, request);
  return yield* HttpServerResponse.schemaJson(GetFileDiffResponse)(response);
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
    FileDiffNotFound: () => Effect.succeed(notFound("The file has no changes")),
    ProjectFilesError: (error) => Effect.succeed(conflict(error.message)),
  }),
  Effect.catch(internalError("get project file diff")),
);
