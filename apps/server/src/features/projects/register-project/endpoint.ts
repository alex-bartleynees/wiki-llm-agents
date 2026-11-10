import { RegisterProjectRequest } from "@wiki-agents/contracts/projects/register-project/request";
import { RegisterProjectResponse } from "@wiki-agents/contracts/projects/register-project/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { registerProject } from "./use-case.js";

export const registerProjectEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.schemaBodyJson(RegisterProjectRequest);
  const response = yield* registerProject(request);
  return yield* HttpServerResponse.schemaJson(RegisterProjectResponse)(response, { status: 201 });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    HttpServerError: () => Effect.succeed(badRequest()),
    InvalidProject: (error) => Effect.succeed(badRequest(error.message)),
  }),
  Effect.catch(internalError("register project")),
);
