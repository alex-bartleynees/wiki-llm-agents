import { AddWorkingDirectoryRequest } from "@wiki-agents/contracts/projects/add-working-directory/request";
import { AddWorkingDirectoryResponse } from "@wiki-agents/contracts/projects/add-working-directory/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { addWorkingDirectory } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const addWorkingDirectoryEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(AddWorkingDirectoryRequest);
  return yield* HttpServerResponse.schemaJson(AddWorkingDirectoryResponse)(yield* addWorkingDirectory(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("add working directory")),
);
