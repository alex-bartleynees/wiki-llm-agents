import { IgnoreFileRequest } from "@wiki-agents/contracts/projects/ignore-file/request";
import { IgnoreFileResponse } from "@wiki-agents/contracts/projects/ignore-file/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { ignoreFile } from "./use-case.js";

const Params = Schema.Struct({ projectId: Schema.String });

/** The project comes from the route, the file from the body. */
export const ignoreFileEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const body = yield* HttpServerRequest.schemaBodyJson(IgnoreFileRequest);
  return yield* HttpServerResponse.schemaJson(IgnoreFileResponse)(yield* ignoreFile(projectId, body));
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("ignore project file")),
);
