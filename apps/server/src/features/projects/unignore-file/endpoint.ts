import { UnignoreFileRequest } from "@wiki-agents/contracts/projects/unignore-file/request";
import { UnignoreFileResponse } from "@wiki-agents/contracts/projects/unignore-file/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { unignoreFile } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const unignoreFileEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const request = yield* HttpServerRequest.schemaSearchParams(UnignoreFileRequest);
  return yield* HttpServerResponse.schemaJson(UnignoreFileResponse)(yield* unignoreFile(projectId, request));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("unignore project file")),
);
