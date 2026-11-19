import { GetBrowserSignInsResponse } from "@wiki-agents/contracts/projects/get-browser-sign-ins/response";
import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { badRequest, internalError, notFound } from "../../../shared/http-errors.js";
import { findProject } from "../find-project.js";
import { ProjectRepository } from "../repository.js";

const Params = Schema.Struct({ projectId: Schema.String });

export const getBrowserSignInsEndpoint = Effect.gen(function* () {
  const { projectId } = yield* HttpRouter.schemaPathParams(Params);
  const project = yield* findProject(projectId);
  const signIns = yield* (yield* ProjectRepository).browserSignIns(project.id);
  return yield* HttpServerResponse.schemaJson(GetBrowserSignInsResponse)({ signIns });
}).pipe(
  Effect.catchTags({
    SchemaError: () => Effect.succeed(badRequest()),
    ProjectNotFound: () => Effect.succeed(notFound("Project not found")),
  }),
  Effect.catch(internalError("get browser sign-ins")),
);
