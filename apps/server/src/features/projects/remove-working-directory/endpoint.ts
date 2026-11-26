import { RemoveWorkingDirectoryRequest } from "@wiki-agents/contracts/projects/remove-working-directory/request";
import { RemoveWorkingDirectoryResponse } from "@wiki-agents/contracts/projects/remove-working-directory/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { removeWorkingDirectory } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const removeWorkingDirectoryEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const request = yield* HttpServerRequest.schemaSearchParams(RemoveWorkingDirectoryRequest);
  return yield* HttpServerResponse.schemaJson(RemoveWorkingDirectoryResponse)(yield* removeWorkingDirectory(projectId, request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("remove working directory")),
);
