import { ListProjectsRequest } from "@wiki-agents/contracts/projects/list-projects/request";
import { ListProjectsResponse } from "@wiki-agents/contracts/projects/list-projects/response";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { badRequest, internalError } from "../../../shared/http-errors.js";
import { ProjectRepository } from "../repository.js";

export const listProjectsEndpoint = Effect.gen(function* () {
  yield* HttpServerRequest.schemaSearchParams(ListProjectsRequest);
  const response: ListProjectsResponse = { projects: yield* (yield* ProjectRepository).list };
  return yield* HttpServerResponse.schemaJson(ListProjectsResponse)(response);
}).pipe(
  Effect.catchTags({ SchemaError: () => Effect.succeed(badRequest()) }),
  Effect.catch(internalError("list projects")),
);
